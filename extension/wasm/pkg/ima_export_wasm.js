/**
 * 逆向重建：wasm-bindgen 胶水层（1:1 还原自产物 background.js 内联的绑定代码）。
 *
 * 原产物把胶水内联进 background.js；这里按原逻辑原样拆成 ES 模块：
 *   - 导入对象只注册 __wbindgen_cast_0000000000000001（externref 表转换）
 *   - 内存/栈操作直接走 wasm 导出的 __wbindgen_export / __wbindgen_export2 / __wbindgen_export3
 *   - 对外只有 core_dispatch(op, contentJson, optionsJson) 与 init/initSync
 *     op = 1 => Markdown，op = 2 => HTML
 */

let wasm;
let cachedDataView = null;
let cachedUint8 = null;

const TEXT_DECODER = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
TEXT_DECODER.decode();
const ENCODER = new TextEncoder();
if (!('encodeInto' in ENCODER)) {
  ENCODER.encodeInto = function (arg, view) {
    const buf = ENCODER.encode(arg);
    view.set(buf);
    return { read: arg.length, written: buf.length };
  };
}

/** wasm-bindgen 的外部对象表（原产物里的 C / H / dr / fr / pr）。 */
const heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);
let heapNext = heap.length;

const FREE_INDEX_FLOOR = 1028;

function addHeapObject(obj) {
  if (heapNext === heap.length) heap.push(heap.length + 1);
  const idx = heapNext;
  heapNext = heap[idx];
  heap[idx] = obj;
  return idx;
}
function dropObject(idx) {
  if (idx < FREE_INDEX_FLOOR) return;
  heap[idx] = heapNext;
  heapNext = idx;
}
function takeObject(idx) {
  const ret = heap[idx];
  dropObject(idx);
  return ret;
}

function getDataView() {
  if (
    cachedDataView === null ||
    cachedDataView.buffer.detached === true ||
    (cachedDataView.buffer.detached === undefined && cachedDataView.buffer !== wasm.memory.buffer)
  ) {
    cachedDataView = new DataView(wasm.memory.buffer);
  }
  return cachedDataView;
}
function getUint8() {
  if (cachedUint8 === null || cachedUint8.byteLength === 0) cachedUint8 = new Uint8Array(wasm.memory.buffer);
  return cachedUint8;
}

const MAX_DECODER_BYTES = 2146435072;
let decodedBytes = 0;
function getStringFromWasm0(ptr, len) {
  decodedBytes += len;
  if (decodedBytes >= MAX_DECODER_BYTES) {
    TEXT_DECODER.decode();
    decodedBytes = len;
  }
  return TEXT_DECODER.decode(getUint8().subarray(ptr, ptr + len));
}

/** 把 JS 字符串写进 wasm 线性内存，返回指针（原产物里的 nt）。 */
function passStringToWasm0(arg, malloc, realloc) {
  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = getUint8();
  let offset = 0;
  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 0x7f) break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) arg = arg.slice(offset);
    ptr = realloc(ptr, len, (len = offset + arg.length * 3), 1) >>> 0;
    const view = getUint8().subarray(ptr + offset, ptr + len);
    offset += ENCODER.encodeInto(arg, view).written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  WASM_VECTOR_LEN = offset;
  return ptr;
}
let WASM_VECTOR_LEN = 0;

/** 传给 wasm 的导入对象（原产物里的 et()）。 */
function getImports() {
  return {
    './ima_export_wasm_bg.js': {
      __wbindgen_cast_0000000000000001: function (arg0, arg1) {
        const ret = getStringFromWasm0(arg0, arg1);
        return addHeapObject(ret);
      },
    },
  };
}

function finalize(instanceExports) {
  wasm = instanceExports;
  cachedDataView = null;
  cachedUint8 = null;
  return wasm;
}

export function initSync(module) {
  if (wasm !== undefined) return wasm;
  if (module !== undefined && Object.getPrototypeOf(module) === Object.prototype) {
    ({ module } = module);
  }
  const imports = getImports();
  if (!(module instanceof WebAssembly.Module)) module = new WebAssembly.Module(module);
  return finalize(new WebAssembly.Instance(module, imports).exports);
}

function isResponse(value) {
  return (
    typeof Response === 'function' && value instanceof Response
  );
}

async function instantiateStreaming(response, imports) {
  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try {
      return await WebAssembly.instantiateStreaming(response, imports);
    } catch (e) {
      if (response.ok && isLikelyCorsResponse(response) && response.headers.get('Content-Type') !== 'application/wasm') {
        console.warn('`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n', e);
      } else {
        throw e;
      }
    }
  }
  const bytes = await response.arrayBuffer();
  return await WebAssembly.instantiate(bytes, imports);
}

function isLikelyCorsResponse(response) {
  switch (response.type) {
    case 'basic':
    case 'cors':
    case 'default':
      return true;
  }
  return false;
}

export default async function init(moduleOrPath) {
  if (wasm !== undefined) return wasm;
  if (moduleOrPath !== undefined && Object.getPrototypeOf(moduleOrPath) === Object.prototype) {
    ({ module_or_path: moduleOrPath } = moduleOrPath);
  }
  const imports = getImports();
  const response = await resolveModule(moduleOrPath);
  const { instance } = await instantiateStreaming(response, imports);
  return finalize(instance.exports);
}

async function resolveModule(moduleOrPath) {
  if (moduleOrPath === undefined) {
    // 扩展环境下由调用方显式传入 runtime.getURL('/wasm/ima_export_wasm_bg.wasm')
    moduleOrPath = new URL('ima_export_wasm_bg.wasm', self.location.href);
  }
  if (typeof moduleOrPath === 'string' || typeof moduleOrPath === 'object' && moduleOrPath !== null && (moduleOrPath instanceof URL || moduleOrPath instanceof Request)) {
    return await fetch(moduleOrPath);
  }
  return moduleOrPath;
}

/**
 * 笔记内容渲染入口（原产物里的 lr）。
 * @param {number} op 1=Markdown, 2=HTML
 * @param {string} contentJson 笔记 content JSON
 * @param {string|null} [optionsJson] { title, linkMap }
 * @returns {string}
 */
export function core_dispatch(op, contentJson, optionsJson) {
  let r0;
  let r1;
  try {
    const stack = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(contentJson, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = optionsJson == null ? 0 : passStringToWasm0(optionsJson, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    wasm.core_dispatch(stack, op, ptr0, len0, ptr1, len1);
    const dataView = getDataView();
    const outPtr = dataView.getInt32(stack + 0, true);
    const outLen = dataView.getInt32(stack + 4, true);
    const errIdx = dataView.getInt32(stack + 8, true);
    const isErr = dataView.getInt32(stack + 12, true);
    if (isErr) {
      r0 = 0;
      r1 = 0;
      throw takeObject(errIdx);
    }
    r0 = outPtr;
    r1 = outLen;
    return getStringFromWasm0(outPtr, outLen);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export3(r0, r1, 1);
  }
}
