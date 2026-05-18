import json
import math
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image as PdfImage
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


Point3D = Tuple[float, float, float]
Edge3D = Tuple[int, int]
Face = List[int]
NX_RUN_JOURNAL = Path(r"C:\Program Files\Siemens\NXStudentEdition2506\NXBIN\run_journal.exe")


def parse_obj(file_path: Path):
    vertices: List[Point3D] = []
    faces: List[Face] = []
    with file_path.open("r", encoding="utf-8", errors="ignore") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("v "):
                _, x, y, z, *_ = line.split()
                vertices.append((float(x), float(y), float(z)))
            elif line.startswith("f "):
                face: Face = []
                for token in line.split()[1:]:
                    index = token.split("/")[0]
                    if index:
                        face.append(int(index) - 1)
                if len(face) >= 2:
                    faces.append(face)
    return vertices, faces


def parse_ascii_stl(file_path: Path):
    triangles: List[List[Point3D]] = []
    current: List[Point3D] = []
    with file_path.open("r", encoding="utf-8", errors="ignore") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if line.startswith("vertex"):
                _, x, y, z = line.split()
                current.append((float(x), float(y), float(z)))
                if len(current) == 3:
                    triangles.append(current)
                    current = []

    vertices: List[Point3D] = []
    faces: List[Face] = []
    index_map: Dict[Point3D, int] = {}
    for triangle in triangles:
        face: Face = []
        for point in triangle:
            if point not in index_map:
                index_map[point] = len(vertices)
                vertices.append(point)
            face.append(index_map[point])
        faces.append(face)
    return vertices, faces


def parse_step_with_gmsh(file_path: Path):
    try:
        import gmsh
    except Exception as exc:
        raise ValueError("STEP/STP support requires the local gmsh runtime, which is not available.") from exc

    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Terminal", 1)
        gmsh.model.add(file_path.stem)
        gmsh.open(str(file_path))
        try:
            gmsh.model.mesh.generate(2)
        except Exception:
            gmsh.model.mesh.generate(3)

        node_tags, coords, _ = gmsh.model.mesh.getNodes()
        if len(node_tags) == 0:
            raise ValueError("No geometry nodes could be extracted from the uploaded STEP/STP file.")

        vertices: List[Point3D] = []
        index_map: Dict[int, int] = {}
        coords_array = np.array(coords, dtype=float).reshape(-1, 3)
        for raw_index, node_tag in enumerate(node_tags):
            index_map[int(node_tag)] = raw_index
            vertices.append((
                float(coords_array[raw_index, 0]),
                float(coords_array[raw_index, 1]),
                float(coords_array[raw_index, 2]),
            ))

        faces: List[Face] = []
        element_types, _, element_nodes = gmsh.model.mesh.getElements(2)
        for element_type, nodes in zip(element_types, element_nodes):
            if element_type == 2:
                width = 3
            elif element_type == 3:
                width = 4
            else:
                continue

            for offset in range(0, len(nodes), width):
                raw_face = [index_map[int(node)] for node in nodes[offset:offset + width] if int(node) in index_map]
                if len(raw_face) >= 3:
                    faces.append(raw_face)

        if not faces:
            element_types, _, element_nodes = gmsh.model.mesh.getElements()
            for element_type, nodes in zip(element_types, element_nodes):
                if element_type == 4:
                    width = 4
                else:
                    continue
                for offset in range(0, len(nodes), width):
                    tetra = [index_map[int(node)] for node in nodes[offset:offset + width] if int(node) in index_map]
                    if len(tetra) == 4:
                        faces.extend([
                            [tetra[0], tetra[1], tetra[2]],
                            [tetra[0], tetra[1], tetra[3]],
                            [tetra[1], tetra[2], tetra[3]],
                            [tetra[0], tetra[2], tetra[3]],
                        ])

        if not faces:
            raise ValueError("The STEP/STP file was loaded, but no drawable surface mesh could be generated for the report.")

        return vertices, faces
    finally:
        gmsh.finalize()


def export_prt_to_obj_with_nx(file_path: Path) -> Path:
    if not NX_RUN_JOURNAL.exists():
        raise ValueError("PRT support requires Siemens NX local export tooling, but NX run_journal.exe was not found on this machine.")

    work_dir = file_path.parent
    output_obj = work_dir / f"{file_path.stem}.nx-export.obj"
    journal_path = work_dir / "export_prt_to_obj.py"
    journal_code = f"""
import NXOpen
import NXOpen.UF
import os

the_session = NXOpen.Session.GetSession()
uf_session = NXOpen.UF.UFSession.GetUFSession()
part_path = r\"{str(file_path)}\"
output_obj = r\"{str(output_obj)}\"

base_part, load_status = the_session.Parts.OpenBaseDisplay(part_path)
if load_status:
    load_status.Dispose()
the_session.Parts.SetDisplay(base_part, False, False, NXOpen.PartDisplayPartWorkPartOption.SameAsDisplay)
the_session.Parts.SetWork(base_part)

uf_session.Part.ExportWithOptions(
    part_path,
    output_obj,
    "OBJ",
    ""
)
"""
    journal_path.write_text(journal_code, encoding="utf-8")

    try:
        result = subprocess.run(
            [str(NX_RUN_JOURNAL), str(journal_path)],
            capture_output=True,
            text=True,
            check=False,
            timeout=120,
        )
    except Exception as exc:
        raise ValueError("Failed to start NX local export for the uploaded PRT file.") from exc

    if result.returncode != 0 or not output_obj.exists():
        details = (result.stderr or result.stdout or "").strip()
        raise ValueError(
            "PRT local export through NX did not complete successfully. "
            + (details if details else "Please export the part to OBJ or STL in NX and upload that file for now.")
        )

    return output_obj


def load_mesh(file_path: Path):
    suffix = file_path.suffix.lower()
    if suffix == ".obj":
        return parse_obj(file_path)
    if suffix == ".stl":
        return parse_ascii_stl(file_path)
    if suffix in {".step", ".stp"}:
        return parse_step_with_gmsh(file_path)
    if suffix == ".mtl":
        raise ValueError("MTL files store material definitions only. Please upload the matching OBJ or STL mesh file.")
    if suffix == ".prt":
        exported_obj = export_prt_to_obj_with_nx(file_path)
        return parse_obj(exported_obj)
    raise ValueError("Unsupported CAD file type. Please upload OBJ, STL, STEP, STP, MTL, or PRT.")


def build_edges(faces: Sequence[Face]) -> List[Edge3D]:
    edge_set = set()
    for face in faces:
        for index in range(len(face)):
            a = face[index]
            b = face[(index + 1) % len(face)]
            if a == b:
                continue
            edge_set.add(tuple(sorted((a, b))))
    return sorted(edge_set)


def projection_image(vertices: Sequence[Point3D], edges: Sequence[Edge3D], axes: Tuple[int, int], output_path: Path, title: str):
    if not vertices:
      raise ValueError("No mesh vertices found.")

    size = 900
    margin = 70
    background = (250, 250, 252)
    image = Image.new("RGB", (size, size), background)
    draw = ImageDraw.Draw(image)

    points_2d = [(vertex[axes[0]], vertex[axes[1]]) for vertex in vertices]
    xs = [point[0] for point in points_2d]
    ys = [point[1] for point in points_2d]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 1e-6)
    span_y = max(max_y - min_y, 1e-6)
    scale = min((size - margin * 2) / span_x, (size - margin * 2) / span_y)

    def map_point(point):
        x = margin + (point[0] - min_x) * scale
        y = size - margin - (point[1] - min_y) * scale
        return x, y

    draw.rectangle([margin - 20, margin - 20, size - margin + 20, size - margin + 20], outline=(180, 188, 201), width=2)

    for a, b in edges:
        p1 = map_point(points_2d[a])
        p2 = map_point(points_2d[b])
        draw.line([p1, p2], fill=(30, 41, 59), width=2)

    draw.text((margin, 18), title, fill=(15, 23, 42))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)


def dominant_angles(vertices: Sequence[Point3D], edges: Sequence[Edge3D], axes: Tuple[int, int]) -> List[float]:
    counter: Counter[int] = Counter()
    for a, b in edges:
        p1 = vertices[a]
        p2 = vertices[b]
        dx = p2[axes[0]] - p1[axes[0]]
        dy = p2[axes[1]] - p1[axes[1]]
        if abs(dx) < 1e-9 and abs(dy) < 1e-9:
            continue
        angle = (math.degrees(math.atan2(dy, dx)) + 360.0) % 180.0
        bucket = int(round(angle))
        counter[bucket] += 1
    return [float(angle) for angle, _ in counter.most_common(6)]


def estimate_radii(vertices: Sequence[Point3D]) -> List[float]:
    array = np.array(vertices, dtype=float)
    center = array.mean(axis=0)
    radial = np.sqrt(np.sum((array[:, :2] - center[:2]) ** 2, axis=1))
    rounded = [round(float(value), 3) for value in radial if value > 1e-6]
    counts = Counter(rounded)
    radii = [value for value, count in counts.most_common(8) if count >= max(8, len(vertices) // 50)]
    return radii[:6]


def build_pdf_report(output_pdf: Path, summary: dict, image_paths: Dict[str, Path]):
    doc = SimpleDocTemplate(
        str(output_pdf),
        pagesize=landscape(A4),
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
    )
    styles = getSampleStyleSheet()
    body_style = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=9, leading=12)
    title_style = styles["Title"]

    story = [
        Paragraph("CAD Drawing Report", title_style),
        Spacer(1, 6),
        Paragraph(
            f"<b>File:</b> {summary['fileName']} &nbsp;&nbsp;&nbsp; <b>Format:</b> {summary['fileType']}",
            body_style,
        ),
        Spacer(1, 6),
    ]

    metrics_table = Table([
        ["Width", f"{summary['dimensions']['width']:.3f}", "Height", f"{summary['dimensions']['height']:.3f}", "Depth", f"{summary['dimensions']['depth']:.3f}"],
        ["Diagonal", f"{summary['dimensions']['diagonal']:.3f}", "Vertices", str(summary['mesh']['vertexCount']), "Edges", str(summary['mesh']['edgeCount'])],
        ["Faces", str(summary['mesh']['faceCount']), "Center", summary['dimensions']['centerText'], "Bounds", summary['dimensions']['boundsText']],
        ["Detected radii", summary['analysis']['radiiText'], "Top angles", summary['analysis']['topAnglesText'], "Front angles", summary['analysis']['frontAnglesText']],
        ["Side angles", summary['analysis']['sideAnglesText'], "Generated at", summary['generatedAt'], "Units", summary['analysis']['units']],
    ], colWidths=[24 * mm, 34 * mm, 24 * mm, 34 * mm, 24 * mm, 90 * mm])
    metrics_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.whitesmoke),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.extend([metrics_table, Spacer(1, 10)])

    image_table = Table([
        [
            PdfImage(str(image_paths["front"]), width=82 * mm, height=82 * mm),
            PdfImage(str(image_paths["top"]), width=82 * mm, height=82 * mm),
            PdfImage(str(image_paths["side"]), width=82 * mm, height=82 * mm),
        ],
        [
            Paragraph("<b>Front view</b>", body_style),
            Paragraph("<b>Top view</b>", body_style),
            Paragraph("<b>Side view</b>", body_style),
        ],
    ], colWidths=[88 * mm, 88 * mm, 88 * mm])
    image_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
    ]))
    story.append(image_table)
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "This report uses orthographic edge projections derived from the uploaded mesh. "
        "Radius and angle values are inferred from available geometry and are intended for rapid engineering review.",
        body_style,
    ))

    doc.build(story)


def main():
    if len(sys.argv) != 6:
        print("Usage: cad_drawing_report.py <mesh_file> <output_json> <output_pdf> <image_dir> <public_prefix>", file=sys.stderr)
        sys.exit(1)

    mesh_path = Path(sys.argv[1])
    output_json = Path(sys.argv[2])
    output_pdf = Path(sys.argv[3])
    image_dir = Path(sys.argv[4])
    public_prefix = sys.argv[5].strip("/")

    vertices, faces = load_mesh(mesh_path)
    if not vertices:
        raise ValueError("No geometry vertices found in the uploaded mesh.")
    edges = build_edges(faces)

    array = np.array(vertices, dtype=float)
    mins = array.min(axis=0)
    maxs = array.max(axis=0)
    center = array.mean(axis=0)
    width, depth, height = maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]
    diagonal = float(np.linalg.norm(maxs - mins))

    image_dir.mkdir(parents=True, exist_ok=True)
    front_path = image_dir / "front-view.png"
    top_path = image_dir / "top-view.png"
    side_path = image_dir / "side-view.png"
    projection_image(vertices, edges, (0, 2), front_path, "Front view (X-Z)")
    projection_image(vertices, edges, (0, 1), top_path, "Top view (X-Y)")
    projection_image(vertices, edges, (1, 2), side_path, "Side view (Y-Z)")

    top_angles = dominant_angles(vertices, edges, (0, 1))
    front_angles = dominant_angles(vertices, edges, (0, 2))
    side_angles = dominant_angles(vertices, edges, (1, 2))
    radii = estimate_radii(vertices)

    summary = {
        "fileName": mesh_path.name,
        "fileType": mesh_path.suffix.lower().lstrip("."),
        "generatedAt": __import__("datetime").datetime.now().isoformat(),
        "mesh": {
            "vertexCount": len(vertices),
            "faceCount": len(faces),
            "edgeCount": len(edges),
        },
        "dimensions": {
            "width": float(width),
            "depth": float(depth),
            "height": float(height),
            "diagonal": diagonal,
            "center": [float(center[0]), float(center[1]), float(center[2])],
            "boundsMin": [float(mins[0]), float(mins[1]), float(mins[2])],
            "boundsMax": [float(maxs[0]), float(maxs[1]), float(maxs[2])],
            "centerText": f"({center[0]:.3f}, {center[1]:.3f}, {center[2]:.3f})",
            "boundsText": f"min({mins[0]:.3f}, {mins[1]:.3f}, {mins[2]:.3f}) max({maxs[0]:.3f}, {maxs[1]:.3f}, {maxs[2]:.3f})",
        },
        "analysis": {
            "units": "model units",
            "dominantAngles": {
                "top": top_angles,
                "front": front_angles,
                "side": side_angles,
            },
            "detectedRadii": radii,
            "topAnglesText": ", ".join(f"{value:.0f}°" for value in top_angles) if top_angles else "n/a",
            "frontAnglesText": ", ".join(f"{value:.0f}°" for value in front_angles) if front_angles else "n/a",
            "sideAnglesText": ", ".join(f"{value:.0f}°" for value in side_angles) if side_angles else "n/a",
            "radiiText": ", ".join(f"{value:.3f}" for value in radii) if radii else "n/a",
        },
        "views": {
            "front": f"/{public_prefix}/front-view.png",
            "top": f"/{public_prefix}/top-view.png",
            "side": f"/{public_prefix}/side-view.png",
            "pdf": f"/{public_prefix}/drawing-report.pdf",
        },
    }

    build_pdf_report(output_pdf, summary, {"front": front_path, "top": top_path, "side": side_path})
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
