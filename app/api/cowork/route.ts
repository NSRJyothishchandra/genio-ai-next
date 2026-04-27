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
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

type PrecisionPartType = "auto" | "gear" | "bolt" | "custom";

interface PrecisionSpec {
  enabled: boolean;
  partType: PrecisionPartType;
  units: string;
  primaryToothCount?: number;
  additionalToothCounts?: number[];
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

function ensureBlenderOutputDir() {
  if (!fs.existsSync(BLENDER_OUTPUT_DIR)) {
    fs.mkdirSync(BLENDER_OUTPUT_DIR, { recursive: true });
  }
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
    raw.partType === "gear" || raw.partType === "bolt" || raw.partType === "custom"
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
    primaryToothCount: normalizePositiveNumber(raw.primaryToothCount),
    additionalToothCounts,
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
            (center - pitch * 0.12, outer_radius * 0.985),
            (center - pitch * 0.04, outer_radius),
            (center + pitch * 0.04, outer_radius),
            (center + pitch * 0.12, outer_radius * 0.985),
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
    bev.segments = 3
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bev.name)
    bpy.ops.object.shade_smooth()
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
offset = -((len(gear_counts) - 1) * spacing) / 2
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
    bsdf.inputs['Base Color'].default_value = colors[index % len(colors)]
    bsdf.inputs['Metallic'].default_value = 0.85
    bsdf.inputs['Roughness'].default_value = 0.25
    gear.data.materials.append(mat)
    gears.append(gear)

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
thread_turns = 6

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=shaft_radius, depth=shaft_length, location=(0, 0, shaft_length / 2))
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
curve_data.resolution_u = 24
spline = curve_data.splines.new('NURBS')
points = thread_turns * 48 + 1
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
bevel.segments = 2
bpy.ops.object.shade_smooth()
mat = bpy.data.materials.new(name='Steel')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (0.48, 0.5, 0.55, 1)
bsdf.inputs['Metallic'].default_value = 0.95
bsdf.inputs['Roughness'].default_value = 0.22
bolt.data.materials.append(mat)
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
  if (partType === "gear" || (partType === "auto" && lower.includes("gear"))) {
    return buildGearFallbackScript(baseName, prompt, spec);
  }
  if (partType === "bolt" || (partType === "auto" && lower.includes("bolt"))) {
    return buildBoltFallbackScript(baseName, spec);
  }
  return null;
}

function shouldPreferProceduralGenerator(prompt: string, spec?: PrecisionSpec) {
  const lower = prompt.toLowerCase();
  if (spec?.enabled && (spec.partType === "gear" || spec.partType === "bolt")) return true;
  if (lower.includes("gear") || lower.includes("bolt")) return true;
  return false;
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

function streamClaudeCli(prompt: string, workdir: string | undefined, sessionId: string, send: (data: object) => void) {
  const child = spawn(
    "claude",
    ["-p", "--output-format", "stream-json", "--verbose", prompt],
    {
      cwd: workdir && workdir.trim() ? workdir.trim() : process.cwd(),
      shell: true,
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

      if (target === "cli") {
        send({ type: "info", text: "💻 Running the full Claude CLI locally" });
        const child = streamClaudeCli(prompt, workdir, sessionId, send);

        child.on("close", (code) => {
          runningProcesses.delete(sessionId);
          send({ type: "done", exitCode: code, sessionId });
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

      const plan = createAutomationPlan(prompt, target, (line) => send(line));
      send({ type: "info", text: `🧠 Automation plan (${plan.planner}): ${describePlan(plan)}` });

      try {
        if ((target === "desktop" || target === "all") && plan.desktop) {
          await executeDesktopAutomation(plan.desktop, (line) => send(line));
        }

        if ((target === "browser" || target === "all") && plan.browser) {
          await executeBrowserAutomation(plan.browser, (line) => send(line));
        }

        if (target === "all") {
          send({ type: "info", text: "💻 Running the full Claude CLI after desktop/browser execution" });
          const child = streamClaudeCli(prompt, workdir, sessionId, send);

          child.on("close", (code) => {
            runningProcesses.delete(sessionId);
            send({ type: "done", exitCode: code, sessionId });
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
