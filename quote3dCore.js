(function initMachTileQuote3dCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MachTileQuote3dCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createQuote3dCore() {
  "use strict";

  const SUPPORTED_EXTENSIONS = ["stl", "step", "stp", "iges", "igs"];
  const number = (value) => Number(value);
  const finite = (value) => Number.isFinite(number(value)) ? number(value) : null;

  function extensionOf(name) {
    return String(name || "").toLowerCase().split(".").pop();
  }

  function summarizeVertices(vertices, triangleCount) {
    if (!vertices.length) return null;
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    let signedVolume = 0;
    vertices.forEach((triangle) => {
      triangle.forEach((point) => {
        min.x = Math.min(min.x, point.x); min.y = Math.min(min.y, point.y); min.z = Math.min(min.z, point.z);
        max.x = Math.max(max.x, point.x); max.y = Math.max(max.y, point.y); max.z = Math.max(max.z, point.z);
      });
      const [a, b, c] = triangle;
      signedVolume += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
    });
    return {
      triangleCount,
      bounds: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
      volumeMm3: Math.abs(signedVolume),
    };
  }

  function parseBinaryStl(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 84) return null;
    const count = view.getUint32(80, true);
    if (84 + count * 50 !== view.byteLength) return null;
    const triangles = [];
    let offset = 84;
    for (let index = 0; index < count; index += 1, offset += 50) {
      const triangle = [];
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const base = offset + 12 + vertex * 12;
        triangle.push({ x: view.getFloat32(base, true), y: view.getFloat32(base + 4, true), z: view.getFloat32(base + 8, true) });
      }
      triangles.push(triangle);
    }
    return summarizeVertices(triangles, count);
  }

  function parseAsciiStl(text) {
    const points = [...String(text || "").matchAll(/vertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/gi)]
      .map((match) => ({ x: number(match[1]), y: number(match[2]), z: number(match[3]) }))
      .filter((point) => Object.values(point).every(Number.isFinite));
    const triangles = [];
    for (let index = 0; index + 2 < points.length; index += 3) triangles.push(points.slice(index, index + 3));
    return summarizeVertices(triangles, triangles.length);
  }

  function inspectModel({ name, buffer, text }) {
    const extension = extensionOf(name);
    if (!SUPPORTED_EXTENSIONS.includes(extension)) return { ok: false, error: "UNSUPPORTED_MODEL_FORMAT" };
    if (extension !== "stl") {
      return {
        ok: true,
        extension,
        geometryAvailable: false,
        warning: "STEP／IGES 第一版只接受檔案辨識；請人工填寫毛胚尺寸與 CAM 預估工時。",
      };
    }
    const geometry = buffer ? parseBinaryStl(buffer) : null;
    const parsed = geometry || parseAsciiStl(text);
    if (!parsed) return { ok: false, error: "INVALID_STL" };
    return { ok: true, extension, geometryAvailable: true, ...parsed };
  }

  function calculateQuote(input = {}) {
    const quantity = Math.round(finite(input.quantity) || 0);
    const stockX = finite(input.stockX), stockY = finite(input.stockY), stockZ = finite(input.stockZ);
    const density = finite(input.materialDensity), priceKg = finite(input.materialPricePerKg);
    const setups = Math.round(finite(input.setups) || 0), setupMinutes = finite(input.setupMinutes);
    const machiningMinutes = finite(input.machiningMinutes), machineRate = finite(input.machineRate);
    const inspectionMinutes = finite(input.inspectionMinutes) || 0, inspectionRate = finite(input.inspectionRate) || 0;
    const extraCost = finite(input.extraCost) || 0, marginPct = finite(input.marginPct) || 0;
    const errors = [];
    if (quantity < 1) errors.push("QUANTITY_REQUIRED");
    if (![stockX, stockY, stockZ].every((value) => value > 0)) errors.push("STOCK_DIMENSIONS_REQUIRED");
    if (!(density > 0) || !(priceKg >= 0)) errors.push("MATERIAL_RATE_REQUIRED");
    if (setups < 1 || !(setupMinutes >= 0)) errors.push("SETUP_REQUIRED");
    if (!(machiningMinutes > 0) || !(machineRate > 0)) errors.push("MACHINING_RATE_REQUIRED");
    if (inspectionMinutes < 0 || inspectionRate < 0 || extraCost < 0) errors.push("NEGATIVE_COST");
    if (marginPct < 0 || marginPct >= 80) errors.push("INVALID_MARGIN");
    if (errors.length) return { ok: false, errors };
    const stockVolumeMm3 = stockX * stockY * stockZ;
    const stockWeightKg = stockVolumeMm3 / 1000 * density / 1000;
    const materialPerPart = stockWeightKg * priceKg;
    const setupCost = setups * setupMinutes / 60 * machineRate;
    const machiningPerPart = machiningMinutes / 60 * machineRate;
    const inspectionPerPart = inspectionMinutes / 60 * inspectionRate;
    const cost = materialPerPart * quantity + setupCost + machiningPerPart * quantity + inspectionPerPart * quantity + extraCost;
    const quoteTotal = cost / (1 - marginPct / 100);
    return {
      ok: true, quantity, stockVolumeMm3, stockWeightKg, materialPerPart, setupCost, machiningPerPart,
      inspectionPerPart, extraCost, cost, marginPct, quoteTotal, quotePerPart: quoteTotal / quantity,
      profit: quoteTotal - cost,
    };
  }

  return { SUPPORTED_EXTENSIONS, calculateQuote, extensionOf, inspectModel, parseAsciiStl, parseBinaryStl };
}));
