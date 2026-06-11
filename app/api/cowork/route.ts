import { NextRequest } from "next/server";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import {
  checkCliAvailable,
  checkDesktopRunning,
  createAutomationPlan,
  describePlan,
  executeBrowserAutomation,
  executeDesktopAutomation,
  executeInDesktop,
  getBrowserStatus,
  openDesktopApp,
  type CoworkTarget,
} from "./automation";

const runningProcesses = new Map<string, ChildProcess>();
const BLENDER_PATHS = [
  "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe",
  "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe",
  "C:\\Program Files\\Blender Foundation\\Blender 4.1\\blender.exe",
];
const BLENDER_OUTPUT_DIR = "C:\\Users\\Projecta0003\\Downloads\\blender-output";
const TRELLIS_SPACE_URL = "https://prithivmlmods-trellis-2-text-to-3d.hf.space";
const FROGLEO_SPACE_URL = "https://frogleo-image-to-3d.hf.space";
const CLAUDE_BRIDGE_SCRIPT_PATH = path.join(process.cwd(), "scripts", "claude_agent_bridge.py");
const PYTHON_CANDIDATES = [
  "C:\\Users\\Projecta0003\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe",
  "python",
];
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

type PrecisionPartType = "auto" | "gear" | "geartrain" | "bolt" | "shaft" | "coupling" | "planetary" | "belt" | "custom";

interface PrecisionSpec {
  enabled: boolean;
  partType: PrecisionPartType;
  units: string;
  qualityPreset?: "draft" | "balanced" | "high";
  materialPreset?: "steel" | "aluminum" | "brass" | "dark";
  symmetry?: "auto" | "radial" | "bilateral";
  centerOrigin?: boolean;
  smoothShading?: boolean;
  primaryToothCount?: number;
  additionalToothCounts?: number[];
  planetCount?: number;
  shaftSpacing?: number;
  stageCount?: number;
  outerDiameter?: number;
  innerDiameter?: number;
  thickness?: number;
  length?: number;
  shaftDiameter?: number;
  headDiameter?: number;
  headHeight?: number;
  tolerance?: number;
}

function resolveBlenderExecutable() {
  for (const candidate of BLENDER_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolvePythonExecutable() {
  for (const candidate of PYTHON_CANDIDATES) {
    if (candidate === "python") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "python";
}

function ensureBlenderOutputDir() {
  if (!fs.existsSync(BLENDER_OUTPUT_DIR)) {
    fs.mkdirSync(BLENDER_OUTPUT_DIR, { recursive: true });
  }
}

function buildHuggingFaceHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.HUGGINGFACE_API_KEY?.trim()) {
    headers.Authorization = `Bearer ${process.env.HUGGINGFACE_API_KEY.trim()}`;
  }
  return headers;
}

function extractCompletedSsePayload(rawText: string) {
  const eventBlocks = rawText.split(/\r?\n\r?\n/).map((block) => block.trim()).filter(Boolean);
  for (const block of eventBlocks.reverse()) {
    const eventMatch = block.match(/event:\s*([^\r\n]+)/i);
    const dataMatch = block.match(/data:\s*([\s\S]+)/i);
    if (!eventMatch || !dataMatch) continue;
    const eventType = eventMatch[1].trim();
    if (eventType === "error") {
      const message = dataMatch[1].trim();
      throw new Error(
        message && message !== "null"
          ? `Gradio endpoint returned an error event: ${message}`
          : "Gradio endpoint returned an error event."
      );
    }
    if (eventType !== "complete") continue;
    return JSON.parse(dataMatch[1].trim());
  }
  throw new Error(`No complete event found in Gradio response: ${rawText.slice(0, 400)}`);
}

async function callQueuedGradioEndpoint(
  baseUrl: string,
  endpoint: string,
  data: unknown[],
  useApiPrefix = true
) {
  const prefix = useApiPrefix ? "/gradio_api/call" : "/call";
  const headers = buildHuggingFaceHeaders();
  const submitResponse = await fetch(`${baseUrl}${prefix}/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
  });
  if (!submitResponse.ok) {
    throw new Error(`Gradio submit failed for ${endpoint}: HTTP ${submitResponse.status}`);
  }
  const submitPayload = await submitResponse.json() as { event_id?: string };
  if (!submitPayload.event_id) {
    throw new Error(`No Gradio event_id returned for ${endpoint}`);
  }

  const resultResponse = await fetch(`${baseUrl}${prefix}/${endpoint}/${submitPayload.event_id}`, {
    method: "GET",
    headers: process.env.HUGGINGFACE_API_KEY?.trim()
      ? { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY.trim()}` }
      : undefined,
  });
  if (!resultResponse.ok) {
    throw new Error(`Gradio result fetch failed for ${endpoint}: HTTP ${resultResponse.status}`);
  }
  const rawText = await resultResponse.text();
  return extractCompletedSsePayload(rawText);
}

async function downloadRemoteArtifact(url: string, destinationPath: string) {
  const response = await fetch(url, {
    headers: process.env.HUGGINGFACE_API_KEY?.trim()
      ? { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY.trim()}` }
      : undefined,
  });
  if (!response.ok) {
    throw new Error(`Failed to download remote artifact: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(destinationPath, Buffer.from(arrayBuffer));
}

async function runRemoteImageTo3D(
  imageInput: { url: string } | { path: string; url?: string; orig_name?: string; mime_type?: string; meta?: { _type: string } },
  baseName: string,
  send: (data: object) => void
) {
  ensureBlenderOutputDir();
  send({ type: "info", text: "Using Hugging Face Image-to-3D Space to convert the reference image into OBJ..." });
  const frogleoResult = await callQueuedGradioEndpoint(
    FROGLEO_SPACE_URL,
    "gen_shape",
    [
      imageInput,
      5,
      5.5,
      1234,
      256,
      8000,
      10000,
      true,
    ],
    false
  );

  if (!Array.isArray(frogleoResult) || frogleoResult.length < 4) {
    throw new Error("Image-to-3D Space returned an unexpected payload.");
  }

  let remoteObjUrl = "";
  const fileUpdate = frogleoResult[1];
  if (fileUpdate && typeof fileUpdate === "object" && "value" in fileUpdate) {
    const value = (fileUpdate as { value?: { url?: string } }).value;
    if (value?.url) {
      remoteObjUrl = String(value.url);
    }
  }
  if (!remoteObjUrl && typeof frogleoResult[3] === "string" && frogleoResult[3].startsWith("/")) {
    remoteObjUrl = `${FROGLEO_SPACE_URL}${frogleoResult[3]}`;
  }
  if (!remoteObjUrl) {
    throw new Error("Image-to-3D Space did not return a downloadable OBJ URL.");
  }

  const localObjPath = path.join(BLENDER_OUTPUT_DIR, `${baseName}.obj`);
  await downloadRemoteArtifact(remoteObjUrl, localObjPath);
  send({ type: "artifact", text: `${path.basename(localObjPath)} | ${localObjPath}` });
  return localObjPath;
}

async function runRemoteTextTo3D(
  prompt: string,
  baseName: string,
  send: (data: object) => void
) {
  ensureBlenderOutputDir();
  send({ type: "info", text: "Using Hugging Face TRELLIS text-to-image for concept generation..." });
  const trellisImageResult = await callQueuedGradioEndpoint(
    TRELLIS_SPACE_URL,
    "generate_txt2img",
    [prompt],
    true
  );

  const generatedImage = Array.isArray(trellisImageResult) ? trellisImageResult[0] : null;
  const imageUrl = generatedImage && typeof generatedImage === "object" && "url" in generatedImage
    ? String((generatedImage as { url?: string }).url ?? "")
    : "";
  if (!imageUrl) {
    throw new Error("TRELLIS did not return a usable image URL.");
  }
  return runRemoteImageTo3D({ path: imageUrl, url: imageUrl, meta: { _type: "gradio.FileData" } }, baseName, send);
}

function listBlenderArtifacts() {
  ensureBlenderOutputDir();
  return fs
    .readdirSync(BLENDER_OUTPUT_DIR)
    .filter((file) => /\.(obj|mtl)$/i.test(file))
    .map((file) => {
      const fullPath = path.join(BLENDER_OUTPUT_DIR, file);
      const stat = fs.statSync(fullPath);
      return {
        file,
        path: fullPath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, 24);
}

function slugifyPrompt(prompt: string) {
  const cleaned = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return cleaned || "blender_model";
}

function extractPythonCode(output: string) {
  const fenced = output.match(/```(?:python)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return output.trim();
}

function normalizePositiveNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function normalizePrecisionSpec(input: unknown): PrecisionSpec | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const enabled = Boolean(raw.enabled);
  if (!enabled) return undefined;

  const partType =
    raw.partType === "gear" ||
    raw.partType === "geartrain" ||
    raw.partType === "bolt" ||
    raw.partType === "shaft" ||
    raw.partType === "coupling" ||
    raw.partType === "planetary" ||
    raw.partType === "belt" ||
    raw.partType === "custom"
      ? raw.partType
      : "auto";
  const units = typeof raw.units === "string" && raw.units.trim() ? raw.units.trim() : "mm";
  const additionalToothCounts = Array.isArray(raw.additionalToothCounts)
    ? raw.additionalToothCounts.map((value) => normalizePositiveNumber(value)).filter((value): value is number => typeof value === "number")
    : [];

  return {
    enabled,
    partType,
    units,
    qualityPreset:
      raw.qualityPreset === "draft" || raw.qualityPreset === "balanced" || raw.qualityPreset === "high"
        ? raw.qualityPreset
        : "balanced",
    materialPreset:
      raw.materialPreset === "aluminum" || raw.materialPreset === "brass" || raw.materialPreset === "dark" || raw.materialPreset === "steel"
        ? raw.materialPreset
        : "steel",
    symmetry:
      raw.symmetry === "radial" || raw.symmetry === "bilateral" || raw.symmetry === "auto"
        ? raw.symmetry
        : "auto",
    centerOrigin: raw.centerOrigin === false ? false : true,
    smoothShading: raw.smoothShading === false ? false : true,
    primaryToothCount: normalizePositiveNumber(raw.primaryToothCount),
    additionalToothCounts,
    planetCount: normalizePositiveNumber(raw.planetCount),
    shaftSpacing: normalizePositiveNumber(raw.shaftSpacing),
    stageCount: normalizePositiveNumber(raw.stageCount),
    outerDiameter: normalizePositiveNumber(raw.outerDiameter),
    innerDiameter: normalizePositiveNumber(raw.innerDiameter),
    thickness: normalizePositiveNumber(raw.thickness),
    length: normalizePositiveNumber(raw.length),
    shaftDiameter: normalizePositiveNumber(raw.shaftDiameter),
    headDiameter: normalizePositiveNumber(raw.headDiameter),
    headHeight: normalizePositiveNumber(raw.headHeight),
    tolerance: normalizePositiveNumber(raw.tolerance),
  };
}

function buildPrecisionNotes(spec?: PrecisionSpec) {
  if (!spec?.enabled) return "";
  const lines = [
    `Precision mode is enabled. Units: ${spec.units}.`,
    spec.partType !== "auto" ? `Preferred part type: ${spec.partType}.` : null,
    spec.primaryToothCount ? `Primary tooth count: ${spec.primaryToothCount}.` : null,
    spec.additionalToothCounts?.length ? `Additional tooth counts: ${spec.additionalToothCounts.join(", ")}.` : null,
    spec.planetCount ? `Planet count: ${spec.planetCount}.` : null,
    spec.shaftSpacing ? `Shaft spacing: ${spec.shaftSpacing} ${spec.units}.` : null,
    spec.stageCount ? `Stage count: ${spec.stageCount}.` : null,
    spec.qualityPreset ? `Quality preset: ${spec.qualityPreset}.` : null,
    spec.materialPreset ? `Material preset: ${spec.materialPreset}.` : null,
    spec.symmetry && spec.symmetry !== "auto" ? `Symmetry target: ${spec.symmetry}.` : null,
    spec.centerOrigin === false ? "Do not force the model to remain centered at world origin." : "Keep the model centered at world origin when possible.",
    spec.smoothShading === false ? "Prefer hard surface shading over smooth shading." : "Use smooth shading where it improves the hard-surface result.",
    spec.outerDiameter ? `Outer diameter: ${spec.outerDiameter} ${spec.units}.` : null,
    spec.innerDiameter ? `Inner diameter or bore: ${spec.innerDiameter} ${spec.units}.` : null,
    spec.thickness ? `Thickness: ${spec.thickness} ${spec.units}.` : null,
    spec.length ? `Overall length: ${spec.length} ${spec.units}.` : null,
    spec.shaftDiameter ? `Shaft diameter: ${spec.shaftDiameter} ${spec.units}.` : null,
    spec.headDiameter ? `Head diameter: ${spec.headDiameter} ${spec.units}.` : null,
    spec.headHeight ? `Head height: ${spec.headHeight} ${spec.units}.` : null,
    spec.tolerance ? `Target tolerance: ${spec.tolerance} ${spec.units}.` : null,
    "Honor these dimensions over stylistic interpretation whenever there is a conflict.",
  ].filter(Boolean);
  return lines.join("\n");
}

function getMaterialColor(materialPreset: PrecisionSpec["materialPreset"]) {
  switch (materialPreset) {
    case "aluminum":
      return { color: "(0.76, 0.79, 0.82, 1.0)", metallic: 0.82, roughness: 0.28 };
    case "brass":
      return { color: "(0.78, 0.64, 0.30, 1.0)", metallic: 0.88, roughness: 0.24 };
    case "dark":
      return { color: "(0.22, 0.24, 0.28, 1.0)", metallic: 0.92, roughness: 0.30 };
    case "steel":
    default:
      return { color: "(0.60, 0.64, 0.70, 1.0)", metallic: 0.9, roughness: 0.22 };
  }
}

function buildGearFallbackScript(baseName: string, prompt: string, spec?: PrecisionSpec) {
  const objPath = path.join(BLENDER_OUTPUT_DIR, `${baseName}.obj`).replace(/\\/g, "\\\\");
  const matches = [...prompt.matchAll(/(\d+)\s*(?:tooth|teeth|threads?)/gi)];
  const counts = matches.map((match) => Number(match[1])).filter((value) => Number.isFinite(value) && value > 2);
  const precisionCounts = [
    spec?.primaryToothCount,
    ...(spec?.additionalToothCounts ?? []),
  ].filter((value): value is number => typeof value === "number" && value > 2);
  const teethCounts = (precisionCounts.length ? precisionCounts : counts.length ? counts : [5, 12, 18]).slice(0, 4);
  const unitsScale = spec?.units?.toLowerCase() === "inch" || spec?.units?.toLowerCase() === "in" ? 0.0254 : 0.001;
  const outerDiameter = spec?.outerDiameter ? spec.outerDiameter * unitsScale : undefined;
  const innerDiameter = spec?.innerDiameter ? spec.innerDiameter * unitsScale : undefined;
  const thickness = spec?.thickness ? spec.thickness * unitsScale : 0.008;
  const toothDepthRatio = 0.12;
  const qualityPreset = spec?.qualityPreset ?? "balanced";
  const bevelSegments = qualityPreset === "high" ? 4 : qualityPreset === "draft" ? 1 : 3;
  const profileDetail = qualityPreset === "high" ? 0.985 : qualityPreset === "draft" ? 0.975 : 0.98;
  const material = getMaterialColor(spec?.materialPreset);

  return `
import bpy
import math

OBJ_PATH = r"${objPath}"

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

def create_gear(name, teeth, outer_radius, inner_radius, thickness, tooth_depth, location):
    root_radius = max(inner_radius * 1.5, outer_radius - tooth_depth)
    pitch = (2 * math.pi) / teeth
    profile_points = []
    for tooth_index in range(teeth):
        center = tooth_index * pitch
        angle_pairs = [
            (center - pitch * 0.50, root_radius),
            (center - pitch * 0.28, root_radius),
            (center - pitch * 0.12, outer_radius * ${profileDetail}),
            (center - pitch * 0.04, outer_radius),
            (center + pitch * 0.04, outer_radius),
            (center + pitch * 0.12, outer_radius * ${profileDetail}),
            (center + pitch * 0.28, root_radius),
            (center + pitch * 0.50, root_radius),
        ]
        for angle, radius in angle_pairs:
            profile_points.append((math.cos(angle) * radius, math.sin(angle) * radius, 0.0, 1.0))

    curve_data = bpy.data.curves.new(name=f"{name}_Curve", type='CURVE')
    curve_data.dimensions = '2D'
    curve_data.fill_mode = 'BOTH'
    curve_data.extrude = thickness / 2
    spline = curve_data.splines.new('POLY')
    spline.points.add(len(profile_points) - 1)
    for index, point in enumerate(profile_points):
        spline.points[index].co = point
    spline.use_cyclic_u = True

    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.active_object

    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=inner_radius, depth=thickness * 1.4, location=location)
    cutter = bpy.context.active_object
    mod = obj.modifiers.new(name='Hole', type='BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    bev = obj.modifiers.new(name='Bevel', type='BEVEL')
    bev.width = max(outer_radius * 0.018, 0.0006)
    bev.segments = ${bevelSegments}
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bev.name)
    ${spec?.smoothShading === false ? "bpy.ops.object.shade_flat()" : "bpy.ops.object.shade_smooth()"}
    return obj

gear_counts = ${JSON.stringify(teethCounts)}
colors = [
    (0.72, 0.76, 0.82, 1.0),
    (0.79, 0.64, 0.33, 1.0),
    (0.56, 0.67, 0.84, 1.0),
    (0.72, 0.45, 0.58, 1.0),
]
gears = []
max_outer_radius = 0.0
outer_radii = []
inner_radii = []
for teeth in gear_counts:
    radius = ${outerDiameter ? `${outerDiameter} / 2` : "0.012 + (teeth * 0.0015)"}
    inner = ${innerDiameter ? `max(0.001, ${innerDiameter} / 2)` : "max(0.003, radius * 0.22)"}
    outer_radii.append(radius)
    inner_radii.append(inner)
    max_outer_radius = max(max_outer_radius, radius)
spacing = max_outer_radius * 2.8
offset = ${spec?.centerOrigin === false ? "0.0" : "-((len(gear_counts) - 1) * spacing) / 2"}
for index, teeth in enumerate(gear_counts):
    radius = outer_radii[index]
    inner = inner_radii[index]
    depth = max(0.001, radius * ${toothDepthRatio})
    gear = create_gear(
        f"Gear_{teeth}",
        teeth,
        radius,
        inner,
        ${thickness},
        depth,
        (offset + (index * spacing), 0, 0),
    )
    mat = bpy.data.materials.new(name=f"Gear_{teeth}_Mat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = ${material.color}
    bsdf.inputs['Metallic'].default_value = ${material.metallic}
    bsdf.inputs['Roughness'].default_value = ${material.roughness}
    gear.data.materials.append(mat)
    gears.append(gear)

try:
    bpy.ops.wm.obj_export(filepath=OBJ_PATH, export_selected_objects=False)
except Exception:
    bpy.ops.export_scene.obj(filepath=OBJ_PATH, use_selection=False)
print(f"OBJ={OBJ_PATH}")
`.trim();
}

function buildGearTrainFallbackScript(baseName: string, prompt: string, spec?: PrecisionSpec) {
  const objPath = path.join(BLENDER_OUTPUT_DIR, `${baseName}.obj`).replace(/\\/g, "\\\\");
  const matches = [...prompt.matchAll(/(\d+)\s*(?:tooth|teeth)/gi)];
  const counts = matches.map((match) => Number(match[1])).filter((value) => Number.isFinite(value) && value > 5);
  const precisionCounts = [
    spec?.primaryToothCount,
    ...(spec?.additionalToothCounts ?? []),
  ].filter((value): value is number => typeof value === "number" && value > 5);
  const gearCounts = (precisionCounts.length ? precisionCounts : counts.length ? counts : [18, 36]).slice(0, 4);
  const unitsScale = spec?.units?.toLowerCase() === "inch" || spec?.units?.toLowerCase() === "in" ? 0.0254 : 0.001;
  const firstSpacing = spec?.shaftSpacing ? spec.shaftSpacing * unitsScale : undefined;
  const primaryOuterDiameter = spec?.outerDiameter ? spec.outerDiameter * unitsScale : undefined;
  const thickness = spec?.thickness ? spec.thickness * unitsScale : 0.010;
  const shaftRadius = spec?.shaftDiameter ? (spec.shaftDiameter * unitsScale) / 2 : undefined;
  const boreRadius = spec?.innerDiameter ? (spec.innerDiameter * unitsScale) / 2 : undefined;
  const qualityPreset = spec?.qualityPreset ?? "balanced";
  const profileDetail = qualityPreset === "high" ? 0.987 : qualityPreset === "draft" ? 0.975 : 0.982;
  const bevelSegments = qualityPreset === "high" ? 4 : qualityPreset === "draft" ? 1 : 3;
  const qualitySteps = qualityPreset === "high" ? 40 : qualityPreset === "draft" ? 18 : 28;
  const material = getMaterialColor(spec?.materialPreset);

  return `
import bpy
import math

OBJ_PATH = r"${objPath}"

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

gear_counts = ${JSON.stringify(gearCounts)}
primary_teeth = gear_counts[0]
${firstSpacing ? `module = (${firstSpacing} * 2.0) / (gear_counts[0] + gear_counts[1]) if len(gear_counts) > 1 else ${primaryOuterDiameter ? `${primaryOuterDiameter} / (primary_teeth + 2)` : "0.0028"}` : ""}
${!firstSpacing ? `module = ${primaryOuterDiameter ? `${primaryOuterDiameter} / (primary_teeth + 2)` : "0.0028"}` : ""}
thickness = ${thickness}
base_shaft_radius = ${shaftRadius ?? "max(module * 2.2, 0.0045)"}
base_bore_radius = ${boreRadius ?? "max(base_shaft_radius * 1.05, module * 2.4)"}
support_height = thickness * 2.4
bearing_radius_factor = 1.45

def create_material(name, color, metallic, roughness):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat

steel_mat = create_material("GearTrainSteel", ${material.color}, ${material.metallic}, ${material.roughness})
base_mat = create_material("GearTrainBase", (0.18, 0.20, 0.24, 1.0), 0.35, 0.55)

def create_gear(name, teeth, center_x):
    pitch_radius = module * teeth / 2.0
    outer_radius = pitch_radius + module
    root_radius = max(base_bore_radius * 1.55, pitch_radius - 1.15 * module)
    pitch = (2 * math.pi) / teeth
    points = []
    for tooth_index in range(teeth):
        center = tooth_index * pitch
        profile = [
            (center - pitch * 0.50, root_radius),
            (center - pitch * 0.28, root_radius),
            (center - pitch * 0.13, outer_radius * ${profileDetail}),
            (center - pitch * 0.04, outer_radius),
            (center + pitch * 0.04, outer_radius),
            (center + pitch * 0.13, outer_radius * ${profileDetail}),
            (center + pitch * 0.28, root_radius),
            (center + pitch * 0.50, root_radius),
        ]
        for angle, radius in profile:
            points.append((math.cos(angle) * radius, math.sin(angle) * radius, 0.0, 1.0))

    curve = bpy.data.curves.new(name=f"{name}_Curve", type='CURVE')
    curve.dimensions = '2D'
    curve.fill_mode = 'BOTH'
    curve.extrude = thickness / 2.0
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for index, point in enumerate(points):
        spline.points[index].co = point
    spline.use_cyclic_u = True

    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = (center_x, 0, 0)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.active_object

    bpy.ops.mesh.primitive_cylinder_add(vertices=56, radius=base_bore_radius, depth=thickness * 1.5, location=(center_x, 0, 0))
    cutter = bpy.context.active_object
    mod = obj.modifiers.new(name='Bore', type='BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

    bpy.ops.mesh.primitive_cylinder_add(vertices=56, radius=max(base_bore_radius * 1.55, pitch_radius * 0.36), depth=thickness * 1.08, location=(center_x, 0, 0))
    hub = bpy.context.active_object
    hub.name = f"{name}_Hub"
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    hub.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()
    obj = bpy.context.active_object

    bev = obj.modifiers.new(name='Bevel', type='BEVEL')
    bev.width = max(outer_radius * 0.015, 0.0006)
    bev.segments = ${bevelSegments}
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bev.name)
    ${spec?.smoothShading === false ? "bpy.ops.object.shade_flat()" : "bpy.ops.object.shade_smooth()"}
    obj.data.materials.append(steel_mat)
    return obj, pitch_radius, outer_radius

def create_shaft(center_x, gear_outer_radius):
    shaft_length = max(thickness * 5.4, gear_outer_radius * 2.4)
    seat_radius = base_shaft_radius * 1.08
    bpy.ops.mesh.primitive_cylinder_add(vertices=${qualitySteps * 2}, radius=base_shaft_radius, depth=shaft_length, location=(center_x, 0, 0))
    shaft = bpy.context.active_object
    shaft.name = f"Shaft_{center_x:.3f}"
    shaft.rotation_euler.y = math.radians(90)
    shaft.data.materials.append(steel_mat)

    for offset in (-shaft_length * 0.24, shaft_length * 0.24):
        bpy.ops.mesh.primitive_cylinder_add(vertices=${qualitySteps * 2}, radius=seat_radius, depth=gear_outer_radius * 0.46, location=(center_x + offset, 0, 0))
        seat = bpy.context.active_object
        seat.rotation_euler.y = math.radians(90)
        seat.name = f"BearingSeat_{center_x:.3f}_{offset:.3f}"
        seat.data.materials.append(steel_mat)

    key_depth = max(base_shaft_radius * 0.18, 0.0012)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(center_x, base_shaft_radius - key_depth / 2.0, 0))
    cutter = bpy.context.active_object
    cutter.scale = (shaft_length * 0.18, key_depth / 2.0, base_shaft_radius * 0.26)
    mod = shaft.modifiers.new(name='Keyway', type='BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    bpy.context.view_layer.objects.active = shaft
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return shaft_length

def create_support(center_x, gear_outer_radius):
    block_width = max(gear_outer_radius * 1.4, module * 8.0)
    block_depth = max(gear_outer_radius * 1.2, module * 7.0)
    block_height = support_height
    bpy.ops.mesh.primitive_cube_add(size=1, location=(center_x, 0, -(thickness / 2.0 + block_height / 2.0)))
    block = bpy.context.active_object
    block.scale = (block_width / 2.0, block_depth / 2.0, block_height / 2.0)
    block.name = f"Support_{center_x:.3f}"
    block.data.materials.append(base_mat)

    bpy.ops.mesh.primitive_cylinder_add(vertices=${qualitySteps * 2}, radius=base_shaft_radius * bearing_radius_factor, depth=block_depth * 1.02, location=(center_x, 0, 0))
    seat_cutter = bpy.context.active_object
    seat_cutter.rotation_euler.x = math.radians(90)
    seat_mod = block.modifiers.new(name='BearingPocket', type='BOOLEAN')
    seat_mod.operation = 'DIFFERENCE'
    seat_mod.solver = 'EXACT'
    seat_mod.object = seat_cutter
    bpy.context.view_layer.objects.active = block
    bpy.ops.object.modifier_apply(modifier=seat_mod.name)
    bpy.data.objects.remove(seat_cutter, do_unlink=True)

centers = [0.0]
for index in range(1, len(gear_counts)):
    prev_teeth = gear_counts[index - 1]
    teeth = gear_counts[index]
    center_distance = module * (prev_teeth + teeth) / 2.0
    centers.append(centers[-1] + center_distance)

if ${spec?.centerOrigin === false ? "False" : "True"}:
    mid = (centers[0] + centers[-1]) / 2.0
    centers = [value - mid for value in centers]

gears = []
outer_radii = []
pitch_radii = []
for index, teeth in enumerate(gear_counts):
    gear, pitch_radius, outer_radius = create_gear(f"Gear_{teeth}_{index+1}", teeth, centers[index])
    gears.append(gear)
    pitch_radii.append(pitch_radius)
    outer_radii.append(outer_radius)

shaft_lengths = []
for center_x, outer_radius in zip(centers, outer_radii):
    shaft_lengths.append(create_shaft(center_x, outer_radius))
    create_support(center_x, outer_radius)

base_width = (max(centers) - min(centers)) + max(outer_radii) * 3.4
base_depth = max(outer_radii) * 3.2
base_height = max(module * 2.4, thickness * 0.65)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -(thickness / 2.0 + support_height + base_height / 2.0)))
base = bpy.context.active_object
base.name = "GearTrainBase"
base.scale = (base_width / 2.0, base_depth / 2.0, base_height / 2.0)
base.data.materials.append(base_mat)

for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        obj.select_set(True)
bpy.context.view_layer.objects.active = base
bpy.ops.object.join()
assembly = bpy.context.active_object
assembly.name = "ConnectedGearTrainAssembly"
${spec?.smoothShading === false ? "bpy.ops.object.shade_flat()" : "bpy.ops.object.shade_smooth()"}
try:
    bpy.ops.wm.obj_export(filepath=OBJ_PATH, export_selected_objects=False)
except Exception:
    bpy.ops.export_scene.obj(filepath=OBJ_PATH, use_selection=False)
print(f"OBJ={OBJ_PATH}")
`.trim();
}

function buildBoltFallbackScript(baseName: string, spec?: PrecisionSpec) {
  const objPath = path.join(BLENDER_OUTPUT_DIR, `${baseName}.obj`).replace(/\\/g, "\\\\");
  const unitsScale = spec?.units?.toLowerCase() === "inch" || spec?.units?.toLowerCase() === "in" ? 0.0254 : 0.001;
  const shaftLength = spec?.length ? spec.length * unitsScale : undefined;
  const shaftRadius = spec?.shaftDiameter ? (spec.shaftDiameter * unitsScale) / 2 : undefined;
  const headRadius = spec?.headDiameter ? (spec.headDiameter * unitsScale) / 2 : undefined;
  const headHeight = spec?.headHeight ? spec.headHeight * unitsScale : undefined;
  const qualityPreset = spec?.qualityPreset ?? "balanced";
  const radialSegments = qualityPreset === "high" ? 96 : qualityPreset === "draft" ? 36 : 64;
  const threadTurns = spec?.primaryToothCount ? Math.max(3, Math.round(spec.primaryToothCount)) : 6;
  const threadResolution = qualityPreset === "high" ? 72 : qualityPreset === "draft" ? 24 : 48;
  const material = getMaterialColor(spec?.materialPreset);

  return `
import bpy
import math

OBJ_PATH = r"${objPath}"
INCH = 0.0254
shaft_length = ${shaftLength ?? "4.0 * INCH"}
shaft_radius = ${shaftRadius ?? "0.1875 * INCH"}
head_height = ${headHeight ?? "0.25 * INCH"}
head_radius = ${headRadius ?? "0.375 * INCH"}
thread_depth = 0.02 * INCH
thread_turns = ${threadTurns}

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

bpy.ops.mesh.primitive_cylinder_add(vertices=${radialSegments}, radius=shaft_radius, depth=shaft_length, location=(0, 0, shaft_length / 2))
shaft = bpy.context.active_object
shaft.name = 'BoltShaft'
bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=head_radius, depth=head_height, location=(0, 0, -head_height / 2))
head = bpy.context.active_object
head.name = 'BoltHead'
head.rotation_euler.z = math.radians(30)
profile_size = thread_depth
bpy.ops.mesh.primitive_plane_add(size=profile_size, location=(shaft_radius + thread_depth / 2, 0, 0))
profile = bpy.context.active_object
profile.name = 'ThreadProfile'
profile.scale = (1.0, 0.2, 1.0)
profile.rotation_euler.y = math.radians(90)
curve_data = bpy.data.curves.new(name='ThreadPath', type='CURVE')
curve_data.dimensions = '3D'
curve_data.resolution_u = ${qualityPreset === "high" ? 36 : qualityPreset === "draft" ? 12 : 24}
spline = curve_data.splines.new('NURBS')
points = thread_turns * ${threadResolution} + 1
spline.points.add(points - 1)
for i in range(points):
    t = i / (points - 1)
    angle = 2 * math.pi * thread_turns * t
    z = shaft_length * t
    radius = shaft_radius + thread_depth / 2
    x = radius * math.cos(angle)
    y = radius * math.sin(angle)
    spline.points[i].co = (x, y, z, 1)
spline.order_u = 4
spline.use_endpoint_u = True
thread_path = bpy.data.objects.new('ThreadPath', curve_data)
bpy.context.collection.objects.link(thread_path)
curve_data.bevel_mode = 'OBJECT'
curve_data.bevel_object = profile
curve_data.fill_mode = 'FULL'
bpy.ops.object.select_all(action='DESELECT')
thread_path.select_set(True)
bpy.context.view_layer.objects.active = thread_path
bpy.ops.object.convert(target='MESH')
thread_mesh = bpy.context.active_object
thread_mesh.name = 'ThreadMesh'
profile_obj = bpy.data.objects.get('ThreadProfile')
if profile_obj:
    bpy.data.objects.remove(profile_obj, do_unlink=True)
shaft = bpy.data.objects.get('BoltShaft')
head = bpy.data.objects.get('BoltHead')
thread_mesh = bpy.data.objects.get('ThreadMesh')
bpy.ops.object.select_all(action='DESELECT')
for obj in (shaft, head, thread_mesh):
    obj.select_set(True)
bpy.context.view_layer.objects.active = shaft
bpy.ops.object.join()
bolt = bpy.context.active_object
bolt.name = 'Bolt_4in_6threads'
bevel = bolt.modifiers.new(name='Bevel', type='BEVEL')
bevel.width = 0.0004
bevel.segments = ${qualityPreset === "high" ? 3 : 2}
${spec?.smoothShading === false ? "bpy.ops.object.shade_flat()" : "bpy.ops.object.shade_smooth()"}
mat = bpy.data.materials.new(name='Steel')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = ${material.color}
bsdf.inputs['Metallic'].default_value = ${material.metallic}
bsdf.inputs['Roughness'].default_value = ${material.roughness}
bolt.data.materials.append(mat)
if ${spec?.centerOrigin === false ? "False" : "True"}:
    bolt.location = (0, 0, 0)
try:
    bpy.ops.wm.obj_export(filepath=OBJ_PATH, export_selected_objects=False)
except Exception:
    bpy.ops.export_scene.obj(filepath=OBJ_PATH, use_selection=False)
print(f"OBJ={OBJ_PATH}")
`.trim();
}

function buildShaftFallbackScript(baseName: string, spec?: PrecisionSpec) {
  const objPath = path.join(BLENDER_OUTPUT_DIR, `${baseName}.obj`).replace(/\\/g, "\\\\");
  const unitsScale = spec?.units?.toLowerCase() === "inch" || spec?.units?.toLowerCase() === "in" ? 0.0254 : 0.001;
  const shaftLength = spec?.length ? spec.length * unitsScale : 0.18;
  const shaftRadius = spec?.shaftDiameter ? (spec.shaftDiameter * unitsScale) / 2 : 0.012;
  const qualityPreset = spec?.qualityPreset ?? "balanced";
  const segments = qualityPreset === "high" ? 96 : qualityPreset === "draft" ? 40 : 64;
  const keywayDepth = Math.max(shaftRadius * 0.18, 0.0015);
  const material = getMaterialColor(spec?.materialPreset);

  return `
import bpy

OBJ_PATH = r"${objPath}"

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'

bpy.ops.mesh.primitive_cylinder_add(vertices=${segments}, radius=${shaftRadius}, depth=${shaftLength}, location=(0, 0, 0))
shaft = bpy.context.active_object
shaft.name = "DriveShaft"
bpy.ops.mesh.primitive_cube_add(size=1, location=(${shaftRadius - keywayDepth / 2}, 0, 0))
cutter = bpy.context.active_object
cutter.scale = (${keywayDepth / 2}, ${shaftRadius * 0.35}, ${shaftLength * 0.52})
mod = shaft.modifiers.new(name='Keyway', type='BOOLEAN')
mod.operation = 'DIFFERENCE'
mod.solver = 'EXACT'
mod.object = cutter
bpy.context.view_layer.objects.active = shaft
bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.data.objects.remove(cutter, do_unlink=True)
bevel = shaft.modifiers.new(name='Bevel', type='BEVEL')
bevel.width = ${shaftRadius * 0.08}
bevel.segments = ${qualityPreset === "high" ? 3 : 2}
bpy.ops.object.modifier_apply(modifier=bevel.name)
${spec?.smoothShading === false ? "bpy.ops.object.shade_flat()" : "bpy.ops.object.shade_smooth()"}
mat = bpy.data.materials.new(name='ShaftMaterial')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = ${material.color}
bsdf.inputs['Metallic'].default_value = ${material.metallic}
bsdf.inputs['Roughness'].default_value = ${material.roughness}
shaft.data.materials.append(mat)
try:
    bpy.ops.wm.obj_export(filepath=OBJ_PATH, export_selected_objects=False)
except Exception:
    bpy.ops.export_scene.obj(filepath=OBJ_PATH, use_selection=False)
print(f"OBJ={OBJ_PATH}")
`.trim();
}

function buildCouplingFallbackScript(baseName: string, spec?: PrecisionSpec) {
  const objPath = path.join(BLENDER_OUTPUT_DIR, `${baseName}.obj`).replace(/\\/g, "\\\\");
  const unitsScale = spec?.units?.toLowerCase() === "inch" || spec?.units?.toLowerCase() === "in" ? 0.0254 : 0.001;
  const outerRadius = spec?.outerDiameter ? (spec.outerDiameter * unitsScale) / 2 : 0.03;
  const boreRadius = spec?.innerDiameter ? (spec.innerDiameter * unitsScale) / 2 : 0.01;
  const totalLength = spec?.length ? spec.length * unitsScale : 0.07;
  const material = getMaterialColor(spec?.materialPreset);

  return `
import bpy

OBJ_PATH = r"${objPath}"

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'

hub_length = ${totalLength} * 0.36
body_length = ${totalLength} * 0.28
for offset in (-(${totalLength} * 0.32), ${totalLength} * 0.32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=72, radius=${outerRadius}, depth=hub_length, location=(0, 0, offset))
    hub = bpy.context.active_object
    hub.name = f"Hub_{offset}"
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=${boreRadius}, depth=hub_length * 1.2, location=(0, 0, offset))
    cutter = bpy.context.active_object
    mod = hub.modifiers.new(name='Bore', type='BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    bpy.context.view_layer.objects.active = hub
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

bpy.ops.mesh.primitive_cylinder_add(vertices=72, radius=${outerRadius * 0.82}, depth=body_length, location=(0, 0, 0))
sleeve = bpy.context.active_object
sleeve.name = "CouplingSleeve"
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        obj.select_set(True)
bpy.context.view_layer.objects.active = sleeve
bpy.ops.object.join()
coupling = bpy.context.active_object
coupling.name = "FlexibleCoupling"
bevel = coupling.modifiers.new(name='Bevel', type='BEVEL')
bevel.width = ${outerRadius * 0.06}
bevel.segments = ${spec?.qualityPreset === "high" ? 3 : 2}
bpy.ops.object.modifier_apply(modifier=bevel.name)
${spec?.smoothShading === false ? "bpy.ops.object.shade_flat()" : "bpy.ops.object.shade_smooth()"}
mat = bpy.data.materials.new(name='CouplingMaterial')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = ${material.color}
bsdf.inputs['Metallic'].default_value = ${material.metallic}
bsdf.inputs['Roughness'].default_value = ${material.roughness}
coupling.data.materials.append(mat)
try:
    bpy.ops.wm.obj_export(filepath=OBJ_PATH, export_selected_objects=False)
except Exception:
    bpy.ops.export_scene.obj(filepath=OBJ_PATH, use_selection=False)
print(f"OBJ={OBJ_PATH}")
`.trim();
}

function buildPlanetaryFallbackScript(baseName: string, spec?: PrecisionSpec) {
  const objPath = path.join(BLENDER_OUTPUT_DIR, `${baseName}.obj`).replace(/\\/g, "\\\\");
  const unitsScale = spec?.units?.toLowerCase() === "inch" || spec?.units?.toLowerCase() === "in" ? 0.0254 : 0.001;
  const sunTeeth = Math.max(8, Math.round(spec?.primaryToothCount ?? 18));
  const planetTeeth = Math.max(6, Math.round(spec?.additionalToothCounts?.[0] ?? 10));
  const planetCount = Math.max(3, Math.min(5, Math.round(spec?.planetCount ?? 3)));
  const outerRadius = spec?.outerDiameter ? (spec.outerDiameter * unitsScale) / 2 : 0.045;
  const boreRadius = spec?.innerDiameter ? (spec.innerDiameter * unitsScale) / 2 : 0.008;
  const thickness = spec?.thickness ? spec.thickness * unitsScale : 0.01;
  const ringRadius = outerRadius * 1.9;
  const material = getMaterialColor(spec?.materialPreset);

  return `
import bpy
import math

OBJ_PATH = r"${objPath}"

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'

def simple_gear(name, teeth, outer_radius, bore_radius, thickness, location):
    root_radius = outer_radius * 0.84
    pitch = (2 * math.pi) / teeth
    points = []
    for tooth in range(teeth):
        center = tooth * pitch
        profile = [
            (center - pitch * 0.50, root_radius),
            (center - pitch * 0.22, root_radius),
            (center - pitch * 0.06, outer_radius),
            (center + pitch * 0.06, outer_radius),
            (center + pitch * 0.22, root_radius),
            (center + pitch * 0.50, root_radius),
        ]
        for angle, radius in profile:
            points.append((math.cos(angle) * radius, math.sin(angle) * radius, 0.0, 1.0))
    curve = bpy.data.curves.new(name=f"{name}_Curve", type='CURVE')
    curve.dimensions = '2D'
    curve.fill_mode = 'BOTH'
    curve.extrude = thickness / 2
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for index, point in enumerate(points):
        spline.points[index].co = point
    spline.use_cyclic_u = True
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.active_object
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=bore_radius, depth=thickness * 1.25, location=location)
    cutter = bpy.context.active_object
    mod = obj.modifiers.new(name='Bore', type='BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return obj

sun = simple_gear("SunGear", ${sunTeeth}, ${outerRadius * 0.48}, ${boreRadius}, ${thickness}, (0, 0, 0))
planet_distance = ${outerRadius * 0.95}
for index in range(${planetCount}):
    angle = (2 * math.pi * index) / ${planetCount}
    simple_gear(
        f"PlanetGear_{index + 1}",
        ${planetTeeth},
        ${outerRadius * 0.28},
        ${boreRadius * 0.55},
        ${thickness},
        (math.cos(angle) * planet_distance, math.sin(angle) * planet_distance, 0),
    )

bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=${ringRadius}, depth=${thickness * 1.18}, location=(0, 0, 0))
ring = bpy.context.active_object
ring.name = "RingGear"
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=${ringRadius * 0.78}, depth=${thickness * 1.4}, location=(0, 0, 0))
ring_cutter = bpy.context.active_object
ring_mod = ring.modifiers.new(name='Inner', type='BOOLEAN')
ring_mod.operation = 'DIFFERENCE'
ring_mod.solver = 'EXACT'
ring_mod.object = ring_cutter
bpy.context.view_layer.objects.active = ring
bpy.ops.object.modifier_apply(modifier=ring_mod.name)
bpy.data.objects.remove(ring_cutter, do_unlink=True)

bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=${outerRadius * 0.18}, depth=${thickness * 0.8}, location=(0, 0, 0))
carrier_hub = bpy.context.active_object
carrier_hub.name = "PlanetCarrierHub"
for index in range(${planetCount}):
    angle = (2 * math.pi * index) / ${planetCount}
    bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(angle) * ${outerRadius * 0.48}, math.sin(angle) * ${outerRadius * 0.48}, 0))
    arm = bpy.context.active_object
    arm.scale = (${outerRadius * 0.30}, ${thickness * 0.34}, ${thickness * 0.24})
    arm.rotation_euler.z = angle

bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        obj.select_set(True)
bpy.context.view_layer.objects.active = ring
bpy.ops.object.join()
assembly = bpy.context.active_object
assembly.name = "PlanetaryAssembly"
${spec?.smoothShading === false ? "bpy.ops.object.shade_flat()" : "bpy.ops.object.shade_smooth()"}
mat = bpy.data.materials.new(name='PlanetaryMaterial')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = ${material.color}
bsdf.inputs['Metallic'].default_value = ${material.metallic}
bsdf.inputs['Roughness'].default_value = ${material.roughness}
assembly.data.materials.append(mat)
try:
    bpy.ops.wm.obj_export(filepath=OBJ_PATH, export_selected_objects=False)
except Exception:
    bpy.ops.export_scene.obj(filepath=OBJ_PATH, use_selection=False)
print(f"OBJ={OBJ_PATH}")
`.trim();
}

function buildBeltFallbackScript(baseName: string, spec?: PrecisionSpec) {
  const objPath = path.join(BLENDER_OUTPUT_DIR, `${baseName}.obj`).replace(/\\/g, "\\\\");
  const unitsScale = spec?.units?.toLowerCase() === "inch" || spec?.units?.toLowerCase() === "in" ? 0.0254 : 0.001;
  const outerRadius = spec?.outerDiameter ? (spec.outerDiameter * unitsScale) / 2 : 0.035;
  const spacing = spec?.shaftSpacing ? spec.shaftSpacing * unitsScale : 0.12;
  const thickness = spec?.thickness ? spec.thickness * unitsScale : 0.012;
  const material = getMaterialColor(spec?.materialPreset);

  return `
import bpy

OBJ_PATH = r"${objPath}"

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'

for x in (-${spacing / 2}, ${spacing / 2}):
    bpy.ops.mesh.primitive_cylinder_add(vertices=72, radius=${outerRadius}, depth=${thickness * 0.9}, location=(x, 0, 0))
    pulley = bpy.context.active_object
    pulley.rotation_euler.x = 1.5708
    pulley.name = f"Pulley_{x}"

curve = bpy.data.curves.new('BeltPath', type='CURVE')
curve.dimensions = '3D'
curve.resolution_u = 32
spline = curve.splines.new('BEZIER')
spline.bezier_points.add(3)
points = [
    (-${spacing / 2}, 0, ${outerRadius}),
    (${spacing / 2}, 0, ${outerRadius}),
    (${spacing / 2}, 0, -${outerRadius}),
    (-${spacing / 2}, 0, -${outerRadius}),
]
for index, point in enumerate(points):
    spline.bezier_points[index].co = point
    spline.bezier_points[index].handle_left_type = 'AUTO'
    spline.bezier_points[index].handle_right_type = 'AUTO'
spline.use_cyclic_u = True
belt = bpy.data.objects.new('DriveBelt', curve)
bpy.context.collection.objects.link(belt)
bpy.context.view_layer.objects.active = belt
bpy.ops.curve.primitive_bezier_circle_add(radius=${thickness * 0.18}, location=(0, 0, 0))
profile = bpy.context.active_object
curve.bevel_mode = 'OBJECT'
curve.bevel_object = profile
bpy.ops.object.select_all(action='DESELECT')
belt.select_set(True)
bpy.context.view_layer.objects.active = belt
bpy.ops.object.convert(target='MESH')
belt_mesh = bpy.context.active_object
belt_mesh.name = 'BeltMesh'
bpy.data.objects.remove(profile, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        obj.select_set(True)
bpy.context.view_layer.objects.active = belt_mesh
bpy.ops.object.join()
assembly = bpy.context.active_object
assembly.name = 'BeltDriveAssembly'
${spec?.smoothShading === false ? "bpy.ops.object.shade_flat()" : "bpy.ops.object.shade_smooth()"}
mat = bpy.data.materials.new(name='BeltDriveMaterial')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = ${material.color}
bsdf.inputs['Metallic'].default_value = ${material.metallic}
bsdf.inputs['Roughness'].default_value = ${material.roughness}
assembly.data.materials.append(mat)
try:
    bpy.ops.wm.obj_export(filepath=OBJ_PATH, export_selected_objects=False)
except Exception:
    bpy.ops.export_scene.obj(filepath=OBJ_PATH, use_selection=False)
print(f"OBJ={OBJ_PATH}")
`.trim();
}

function buildHeuristicBlenderScript(prompt: string, baseName: string, spec?: PrecisionSpec) {
  const lower = prompt.toLowerCase();
  const partType = spec?.partType ?? "auto";
  if (
    partType === "geartrain" ||
    (partType === "auto" && ((lower.includes("connected gear") || lower.includes("gear train") || lower.includes("meshed gear") || lower.includes("gear pair")) || ((lower.includes("gear") && lower.includes("shaft")) || (lower.includes("gears") && lower.includes("connected")))))
  ) {
    return buildGearTrainFallbackScript(baseName, prompt, spec);
  }
  if (partType === "gear" || (partType === "auto" && lower.includes("gear"))) {
    return buildGearFallbackScript(baseName, prompt, spec);
  }
  if (partType === "bolt" || (partType === "auto" && lower.includes("bolt"))) {
    return buildBoltFallbackScript(baseName, spec);
  }
  if (partType === "shaft" || (partType === "auto" && lower.includes("shaft"))) {
    return buildShaftFallbackScript(baseName, spec);
  }
  if (partType === "coupling" || (partType === "auto" && lower.includes("coupling"))) {
    return buildCouplingFallbackScript(baseName, spec);
  }
  if (partType === "planetary" || (partType === "auto" && (lower.includes("planetary") || lower.includes("sun gear") || lower.includes("ring gear")))) {
    return buildPlanetaryFallbackScript(baseName, spec);
  }
  if (partType === "belt" || (partType === "auto" && (lower.includes("belt") || lower.includes("pulley")))) {
    return buildBeltFallbackScript(baseName, spec);
  }
  return null;
}

function shouldPreferProceduralGenerator(prompt: string, spec?: PrecisionSpec) {
  const lower = prompt.toLowerCase();
  if (spec?.enabled && ["gear", "geartrain", "bolt", "shaft", "coupling", "planetary", "belt"].includes(spec.partType)) return true;
  if (lower.includes("gear") || lower.includes("bolt") || lower.includes("shaft") || lower.includes("coupling") || lower.includes("planetary") || lower.includes("sun gear") || lower.includes("ring gear") || lower.includes("belt") || lower.includes("pulley") || lower.includes("gear train") || lower.includes("connected gear") || lower.includes("meshed gear")) return true;
  return false;
}

function shouldUseRemote3DProvider(prompt: string, spec?: PrecisionSpec, imageDataUrl?: string) {
  const lower = prompt.toLowerCase();
  if (imageDataUrl) return false;
  if (spec?.partType === "auto" || !spec?.partType) {
    if (
      lower.includes("character") ||
      lower.includes("creature") ||
      lower.includes("statue") ||
      lower.includes("figurine") ||
      lower.includes("toy") ||
      lower.includes("vehicle concept") ||
      lower.includes("spaceship") ||
      lower.includes("airplane") ||
      lower.includes("plane") ||
        lower.includes("car concept")
    ) {
      return true;
    }
  }
  if (lower.includes("trellis") || lower.includes("hugging face") || lower.includes("frogleo")) return true;
  return false;
}

function formatPrecisionSummary(spec?: PrecisionSpec) {
  if (!spec?.enabled) return "Precision mode: prompt-driven";
  const parts = [
    `type=${spec.partType}`,
    `units=${spec.units}`,
    spec.qualityPreset ? `quality=${spec.qualityPreset}` : null,
    spec.materialPreset ? `material=${spec.materialPreset}` : null,
    spec.primaryToothCount ? `toothCount=${spec.primaryToothCount}` : null,
    spec.additionalToothCounts?.length ? `extraTeeth=${spec.additionalToothCounts.join("/")}` : null,
    spec.planetCount ? `planets=${spec.planetCount}` : null,
    spec.shaftSpacing ? `shaftSpacing=${spec.shaftSpacing}${spec.units}` : null,
    spec.stageCount ? `stages=${spec.stageCount}` : null,
    spec.outerDiameter ? `outer=${spec.outerDiameter}${spec.units}` : null,
    spec.innerDiameter ? `bore=${spec.innerDiameter}${spec.units}` : null,
    spec.thickness ? `thickness=${spec.thickness}${spec.units}` : null,
    spec.length ? `length=${spec.length}${spec.units}` : null,
  ].filter(Boolean);
  return `Precision mode: ${parts.join(" | ")}`;
}

export async function GET() {
  const browser = getBrowserStatus();
  const blenderPath = resolveBlenderExecutable();

  return Response.json({
    cli: { path: "claude (via PATH)", available: checkCliAvailable() },
    desktop: {
      path: "shell:appsFolder\\AnthropicPBC.Claude_pzs8sxrjxfjjc!App",
      available: true,
      running: checkDesktopRunning(),
    },
    browser: {
      url: browser.executablePath ?? browser.url,
      available: browser.available,
    },
    blender: {
      path: blenderPath,
      available: Boolean(blenderPath),
      outputDir: BLENDER_OUTPUT_DIR,
      artifacts: listBlenderArtifacts(),
    },
    runningProcesses: Array.from(runningProcesses.keys()),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, prompt } = body;

  if (action === "open_desktop") {
    openDesktopApp("claude_desktop");
    return Response.json({ opened: true, method: "shell:appsFolder" });
  }

  if (action === "execute_in_desktop") {
    if (!prompt) return Response.json({ error: "prompt required" }, { status: 400 });
    try {
      executeInDesktop(prompt);
      return Response.json({
        executed: true,
        method: "powershell_sendkeys",
        note: "Prompt pasted and submitted in Claude Desktop",
      });
    } catch (err) {
      return Response.json({ executed: false, error: String(err) }, { status: 500 });
    }
  }

  if (action === "open_browser") {
    const browser = getBrowserStatus();
    if (!browser.executablePath) {
      return Response.json({ error: "No local browser executable found" }, { status: 500 });
    }

    spawn(browser.executablePath, ["https://claude.ai/code"], {
      detached: true,
      windowsHide: false,
      shell: false,
    }).unref();
    return Response.json({ opened: true, url: "https://claude.ai/code" });
  }

  if (action === "kill_all") {
    let killed = 0;
    runningProcesses.forEach((proc) => {
      try {
        proc.kill("SIGTERM");
        killed++;
      } catch {}
    });
    runningProcesses.clear();
    return Response.json({ killed, message: `Killed ${killed} process(es)` });
  }

  if (action === "kill_process") {
    const { processId } = body;
    const proc = runningProcesses.get(processId);
    if (proc) {
      try {
        proc.kill("SIGTERM");
      } catch {}
      runningProcesses.delete(processId);
      return Response.json({ killed: true, processId });
    }
    return Response.json({ killed: false, message: "Process not found" });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id") ?? "all";

  if (id === "all") {
    let killed = 0;
    runningProcesses.forEach((proc) => {
      try {
        proc.kill("SIGTERM");
        killed++;
      } catch {}
    });
    runningProcesses.clear();
    return Response.json({ killed, message: `Killed all ${killed} process(es)` });
  }

  const proc = runningProcesses.get(id);
  if (proc) {
    try {
      proc.kill("SIGTERM");
    } catch {}
    runningProcesses.delete(id);
    return Response.json({ killed: true, processId: id });
  }

  return Response.json({ killed: false, message: "Process not found" }, { status: 404 });
}

function streamClaudeAgentBridge(
  prompt: string,
  workdir: string | undefined,
  sessionId: string,
  send: (data: object) => void,
  target: "cli" | "desktop"
) {
  const python = resolvePythonExecutable();
  const resolvedWorkdir = workdir && workdir.trim() ? workdir.trim() : process.cwd();
  const child = spawn(
    python,
    [
      CLAUDE_BRIDGE_SCRIPT_PATH,
      "--prompt",
      prompt,
      "--workdir",
      resolvedWorkdir,
      "--target",
      target,
    ],
    {
      cwd: process.cwd(),
      shell: python === "python",
      windowsHide: true,
      env: { ...process.env },
    }
  );

  runningProcesses.set(sessionId, child);
  let buffer = "";

  child.stdout.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type === "assistant" && parsed.message) {
          const content = parsed.message.content;
          if (Array.isArray(content)) {
            const text = content
              .filter((item: { type: string }) => item.type === "text")
              .map((item: { text: string }) => item.text)
              .join("");
            if (text) send({ type: "text", text });
          } else if (typeof content === "string" && content) {
            send({ type: "text", text: content });
          }
        } else if (parsed.type === "result" && parsed.result) {
          send({ type: "text", text: `\n📋 Result: ${parsed.result}` });
        } else if (parsed.type === "tool_use") {
          send({ type: "tool", name: parsed.name, input: parsed.input });
        } else {
          send({ type: "data", payload: parsed });
        }
      } catch {
        send({ type: "text", text: trimmed });
      }
    }
  });

  child.stderr.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text) send({ type: "stderr", text });
  });

  return child;
}

function streamClaudeBridgeProcess(
  prompt: string,
  workdir: string | undefined,
  sessionId: string,
  send: (data: object) => void,
  target: "cli" | "desktop"
) {
  const python = resolvePythonExecutable();
  const resolvedWorkdir = workdir && workdir.trim() ? workdir.trim() : process.cwd();
  const child = spawn(
    python,
    [
      CLAUDE_BRIDGE_SCRIPT_PATH,
      "--prompt",
      prompt,
      "--workdir",
      resolvedWorkdir,
      "--target",
      target,
    ],
    {
      cwd: process.cwd(),
      shell: python === "python",
      windowsHide: true,
      env: { ...process.env },
    }
  );

  runningProcesses.set(sessionId, child);
  let buffer = "";

  child.stdout.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        send(JSON.parse(trimmed));
      } catch {
        send({ type: "text", text: trimmed });
      }
    }
  });

  child.stderr.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text) send({ type: "stderr", text });
  });

  return child;
}

function escapePowershellSingleQuoted(text: string) {
  return text.replace(/'/g, "''");
}

function appendCliTerminalLog(logPath: string, text: string) {
  fs.appendFileSync(logPath, `${text.replace(/\r?\n/g, os.EOL)}${os.EOL}`, "utf8");
}

function formatCliTerminalLine(data: Record<string, unknown>) {
  switch (data.type) {
    case "start":
      return String(data.message ?? "Cowork execution started");
    case "info":
      return String(data.text ?? "");
    case "text":
      return String(data.text ?? "");
    case "stderr":
      return `[stderr] ${String(data.text ?? "")}`;
    case "tool":
      return `Tool: ${String(data.name ?? "unknown")}`;
    case "error":
      return `[error] ${String(data.message ?? "Unknown error")}`;
    case "done":
      return `Execution finished with exit code ${String(data.exitCode ?? "")}`;
    default:
      return "";
  }
}

function launchVisibleClaudeTerminal(logPath: string, workdir: string | undefined) {
  const resolvedWorkdir = workdir && workdir.trim() ? workdir.trim() : process.cwd();
  const escapedWorkdir = escapePowershellSingleQuoted(resolvedWorkdir);
  const escapedLogPath = escapePowershellSingleQuoted(logPath);
  const command = [
    `Set-Location -LiteralPath '${escapedWorkdir}'`,
    `$Host.UI.RawUI.WindowTitle = 'Genio AI CLI Agent'`,
    "Write-Host 'Genio AI CLI Agent' -ForegroundColor Cyan",
    `Write-Host ('Working directory: ' + '${escapedWorkdir}') -ForegroundColor DarkGray`,
    `Write-Host ('Streaming log: ' + '${escapedLogPath}') -ForegroundColor DarkGray`,
    "Write-Host ''",
    "while (-not (Test-Path -LiteralPath '" + escapedLogPath + "')) { Start-Sleep -Milliseconds 200 }",
    `Get-Content -LiteralPath '${escapedLogPath}' -Wait`,
  ].join("; ");

  const child = spawn("powershell.exe", ["-NoExit", "-Command", command], {
    cwd: resolvedWorkdir,
    shell: false,
    windowsHide: false,
    detached: true,
    env: { ...process.env },
  });

  child.unref();
  return { workdir: resolvedWorkdir };
}

async function generateBlenderScriptWithClaude(
  prompt: string,
  baseName: string,
  send: (data: object) => void,
  imageDataUrl?: string,
  spec?: PrecisionSpec
) {
  const objPath = path.join(BLENDER_OUTPUT_DIR, `${baseName}.obj`).replace(/\\/g, "\\\\");
  const precisionNotes = buildPrecisionNotes(spec);

  const codegenPrompt = [
    "You are generating a Blender Python script for Blender 5.1 running in background mode.",
    "Return only raw Python code. Do not include markdown fences or explanations.",
    "The script must be fully self-contained and use bpy only.",
    "Requirements:",
    "- Delete the default scene content first.",
    "- Create a visually clear 3D model matching this prompt:",
    prompt,
    precisionNotes || null,
    "- Export the scene to OBJ_PATH.",
    "- Do not save a .blend file.",
    "- Do not render preview images unless explicitly requested in the prompt.",
    "- Prefer dimensionally consistent, clean procedural geometry over decorative scene setup.",
    "- Print exactly this line at the end:",
    "print(f'OBJ={OBJ_PATH}')",
    "- Use this exact constant near the top of the file:",
    `OBJ_PATH = r"${objPath}"`,
    "- Do not ask for input and do not use external packages.",
    "- If bpy.ops.wm.obj_export fails on version differences, fall back to bpy.ops.export_scene.obj.",
  ].filter(Boolean).join("\n");

  send({ type: "info", text: imageDataUrl ? "Generating Blender Python with Claude vision..." : "Generating Blender Python with Claude..." });

  if (imageDataUrl && anthropic) {
    const imageMatch = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!imageMatch) {
      throw new Error("Invalid image format. Please upload a PNG or JPG image.");
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2200,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: codegenPrompt },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: imageMatch[1] as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                data: imageMatch[2],
              },
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => ("text" in block ? block.text : ""))
      .join("\n")
      .trim();

    return extractPythonCode(text);
  }

  const child = spawn("claude", ["-p", codegenPrompt], {
    shell: true,
    windowsHide: true,
    env: { ...process.env },
  });

  return await new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Claude code generation failed with exit code ${code}`));
        return;
      }

      const codeText = extractPythonCode(stdout);
      resolve(codeText);
    });
  });
}

async function runBlenderGeneration(
  prompt: string,
  sessionId: string,
  send: (data: object) => void,
  imageDataUrl?: string,
  spec?: PrecisionSpec
) {
  const blenderPath = resolveBlenderExecutable();
  if (!blenderPath) {
    throw new Error("Blender executable not found on this machine.");
  }

  ensureBlenderOutputDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `${slugifyPrompt(prompt)}_${stamp}`;
  send({ type: "info", text: formatPrecisionSummary(spec) });

  if (shouldUseRemote3DProvider(prompt, spec, imageDataUrl)) {
    try {
      await runRemoteTextTo3D(prompt, baseName, send);
      send({ type: "info", text: "Remote 3D concept generation completed via Hugging Face Spaces." });
      return 0;
    } catch (error) {
      send({
        type: "info",
        text: `Hugging Face text-to-3D fallback was unavailable, switching to local NX agent generation. Reason: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  let scriptText = "";
  const fallback = buildHeuristicBlenderScript(prompt, baseName, spec);

  if (shouldPreferProceduralGenerator(prompt, spec) && fallback) {
    send({ type: "info", text: "Using procedural precision generator for this mechanical part..." });
    scriptText = fallback;
  } else {
    scriptText = await generateBlenderScriptWithClaude(prompt, baseName, send, imageDataUrl, spec);
    if (!scriptText.includes("import bpy")) {
      if (!fallback) {
        throw new Error("Claude did not return a valid Blender Python script for this prompt.");
      }
      send({ type: "info", text: imageDataUrl ? "Vision codegen was too loose, using local Blender fallback generator..." : "Claude codegen was too loose, using local Blender fallback generator..." });
      scriptText = fallback;
    }
  }
  const scriptPath = path.join(os.tmpdir(), `${baseName}.py`);
  fs.writeFileSync(scriptPath, scriptText, "utf8");

  send({ type: "info", text: `Running Blender CLI with generated script: ${path.basename(scriptPath)}` });

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(blenderPath, ["--background", "--python", scriptPath], {
      shell: false,
      windowsHide: true,
      env: { ...process.env },
    });

    runningProcesses.set(sessionId, child);

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) send({ type: "text", text });
    });

    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) send({ type: "stderr", text });
    });

    child.on("error", (error) => {
      runningProcesses.delete(sessionId);
      reject(error);
    });

    child.on("close", (code) => {
      runningProcesses.delete(sessionId);
      const artifacts = listBlenderArtifacts().filter((artifact) => artifact.file.startsWith(baseName));
      send({
        type: "info",
        text: `Validation: exported ${artifacts.length} artifact(s) for ${baseName}${spec?.enabled && spec.tolerance ? ` with target tolerance ${spec.tolerance}${spec.units}` : ""}.`,
      });
      for (const artifact of artifacts) {
        send({ type: "artifact", text: `${artifact.file} | ${artifact.path}` });
      }
      resolve(code ?? 1);
    });
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const workdir = typeof body.workdir === "string" ? body.workdir : undefined;
  const target = (body.target || "cli") as CoworkTarget;
  const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : undefined;
  const precisionSpec = normalizePrecisionSpec(body.precisionSpec);

  if (!prompt.trim()) {
    return Response.json({ error: "prompt required" }, { status: 400 });
  }

  const sessionId = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      send({ type: "start", message: `Cowork execution started for ${target}`, sessionId });

      if (target === "blender") {
        try {
          const exitCode = await runBlenderGeneration(prompt, sessionId, send, imageDataUrl, precisionSpec);
          send({ type: "done", exitCode, sessionId });
        } catch (error) {
          send({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          send({ type: "done", exitCode: 1, sessionId });
        }

        try {
          controller.close();
        } catch {}
        return;
      }

      if (target === "cli" || target === "desktop") {
        const cliLogPath = path.join(os.tmpdir(), `${sessionId}.log`);
        const logAndSend = (data: Record<string, unknown>) => {
          send(data);
          const line = formatCliTerminalLine(data);
          if (line) {
            appendCliTerminalLog(cliLogPath, line);
          }
        };

        try {
          if (!checkCliAvailable()) {
            throw new Error("Claude CLI is not available in PATH on this machine.");
          }
          if (!fs.existsSync(CLAUDE_BRIDGE_SCRIPT_PATH)) {
            throw new Error("Claude bridge script is missing from scripts/claude_agent_bridge.py.");
          }

          fs.writeFileSync(cliLogPath, "", "utf8");
          const launched = launchVisibleClaudeTerminal(cliLogPath, workdir);
          logAndSend({ type: "info", text: `Opened a visible PowerShell window for ${target === "desktop" ? "Desktop Agent" : "CLI Agent"}.` });
          logAndSend({ type: "text", text: `Workdir: ${launched.workdir}` });
          logAndSend({ type: "text", text: `Prompt sent exactly: ${prompt}` });
          logAndSend({ type: "info", text: `Running Claude CLI through the Python bridge for ${target} and streaming the real output...` });

          const child = streamClaudeBridgeProcess(prompt, workdir, sessionId, (line) => {
            logAndSend(line as Record<string, unknown>);
          }, target);

          child.on("close", (code) => {
            runningProcesses.delete(sessionId);
            logAndSend({ type: "info", text: `Bridge process closed with exit code ${code ?? 0}` });
            try {
              controller.close();
            } catch {}
          });
        } catch (error) {
          logAndSend({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          logAndSend({ type: "done", exitCode: 1, sessionId });
          try {
            controller.close();
          } catch {}
        }
        return;
      }

      const plan = createAutomationPlan(prompt, target, (line) => send(line));
      send({ type: "info", text: `🧠 Automation plan (${plan.planner}): ${describePlan(plan)}` });

      try {
        if (target === "all" && plan.desktop) {
          await executeDesktopAutomation(plan.desktop, (line) => send(line));
        }

        if ((target === "browser" || target === "all") && plan.browser) {
          await executeBrowserAutomation(plan.browser, (line) => send(line));
        }

        if (target === "all") {
          send({ type: "info", text: "💻 Running the full Claude CLI after desktop/browser execution" });
          const child = streamClaudeBridgeProcess(prompt, workdir, sessionId, send, "cli");

          child.on("close", (code) => {
            runningProcesses.delete(sessionId);
            send({ type: "info", text: `Bridge process closed with exit code ${code ?? 0}` });
            try {
              controller.close();
            } catch {}
          });

          child.on("error", (err) => {
            runningProcesses.delete(sessionId);
            send({ type: "error", message: err.message });
            try {
              controller.close();
            } catch {}
          });

          const timeout = setTimeout(() => {
            try {
              child.kill("SIGTERM");
            } catch {}
            runningProcesses.delete(sessionId);
            send({ type: "timeout", message: "CLI process timed out after 5 minutes" });
            try {
              controller.close();
            } catch {}
          }, 300_000);

          child.on("close", () => clearTimeout(timeout));
          return;
        }

        send({ type: "done", exitCode: 0, sessionId });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        send({ type: "done", exitCode: 1, sessionId });
      }

      try {
        controller.close();
      } catch {}
    },

    cancel() {
      const proc = runningProcesses.get(sessionId);
      if (proc) {
        try {
          proc.kill("SIGTERM");
        } catch {}
        runningProcesses.delete(sessionId);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Session-Id": sessionId,
    },
  });
}
