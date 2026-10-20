var CoreUI = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // core.ts
  var core_exports = {};
  __export(core_exports, {
    arcMark: () => arcMark,
    icon: () => icon,
    inputBox: () => inputBox,
    quickPick: () => quickPick,
    showDialog: () => showDialog,
    showMenu: () => showMenu,
    statusMark: () => statusMark,
    toast: () => toast
  });

  // ../../../packages/core/src/ui/escapeHtml.ts
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ../../../packages/core/src/library/search/text/fold.ts
  function fold(text) {
    return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
  }

  // ../../../packages/core/src/library/search/text/highlight.ts
  function foldWithMap(text) {
    const out = { folded: "", from: [], to: [] };
    let index = 0;
    for (const ch of text) {
      const piece = fold(ch);
      for (let i = 0; i < piece.length; i++) {
        out.from.push(index);
        out.to.push(index + ch.length);
      }
      out.folded += piece;
      index += ch.length;
    }
    return out;
  }
  function mergeRanges(ranges) {
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const [start, end] of ranges) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) {
        last[1] = Math.max(last[1], end);
      } else {
        merged.push([start, end]);
      }
    }
    return merged;
  }
  function highlightRanges(text, terms) {
    const { folded, from, to } = foldWithMap(text);
    const ranges = [];
    for (const term of terms) {
      const needle = fold(term);
      if (!needle) {
        continue;
      }
      let at = folded.indexOf(needle);
      while (at !== -1) {
        let end = to[at + needle.length - 1];
        while (end < text.length && /\p{M}/u.test(text[end])) {
          end++;
        }
        ranges.push([from[at], end]);
        at = folded.indexOf(needle, at + needle.length);
      }
    }
    return mergeRanges(ranges);
  }

  // ../../../packages/core/src/ui/dom/dom.ts
  function highlight(text, terms) {
    const str = String(text ?? "");
    let out = "";
    let pos = 0;
    for (const [from, to] of highlightRanges(str, terms)) {
      out += escapeHtml(str.slice(pos, from)) + "<mark>" + escapeHtml(str.slice(from, to)) + "</mark>";
      pos = to;
    }
    return out + escapeHtml(str.slice(pos));
  }
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === void 0 || value === false) continue;
      if (key === "html") node.innerHTML = String(value);
      else if (key === "text") node.textContent = String(value);
      else if (key === "class") node.className = String(value);
      else if (key === "style") node.style.cssText = String(value);
      else if (value === true) node.setAttribute(key, "");
      else node.setAttribute(key, String(value));
    }
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      node.append(child);
    }
    return node;
  }

  // ../../../packages/core/src/ui/icons/codiconGlyphs.ts
  var CODICON_GLYPHS = {
    "chevron-down": '<path d="M3.14598 5.85423L7.64598 10.3542C7.84098 10.5492 8.15798 10.5492 8.35298 10.3542L12.853 5.85423C13.048 5.65923 13.048 5.34223 12.853 5.14723C12.658 4.95223 12.341 4.95223 12.146 5.14723L7.99998 9.29323L3.85398 5.14723C3.65898 4.95223 3.34198 4.95223 3.14698 5.14723C2.95198 5.34223 2.95098 5.65923 3.14598 5.85423Z"/>',
    "chevron-right": '<path d="M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z"/>',
    "new-file": '<path d="M5 14C4.448 14 4 13.552 4 13V3C4 2.448 4.448 2 5 2H8V4.5C8 5.328 8.672 6 9.5 6H12V6.025C12.344 6.056 12.677 6.121 13 6.213V5.414C13 5.016 12.842 4.635 12.561 4.353L9.647 1.439C9.366 1.158 8.984 1 8.586 1H5C3.895 1 3 1.895 3 3V13C3 14.105 3.895 15 5 15H7.261C7.008 14.693 6.791 14.357 6.607 14H5ZM9 2.207L11.793 5H9.5C9.224 5 9 4.776 9 4.5V2.207ZM11.5 7C9.015 7 7 9.015 7 11.5C7 13.985 9.015 16 11.5 16C13.985 16 16 13.985 16 11.5C16 9.015 13.985 7 11.5 7ZM14 12H12V14C12 14.276 11.776 14.5 11.5 14.5C11.224 14.5 11 14.276 11 14V12H9C8.724 12 8.5 11.776 8.5 11.5C8.5 11.224 8.724 11 9 11H11V9C11 8.724 11.224 8.5 11.5 8.5C11.776 8.5 12 8.724 12 9V11H14C14.276 11 14.5 11.224 14.5 11.5C14.5 11.776 14.276 12 14 12Z"/>',
    "new-folder": '<path d="M2 4.5V6H5.58579C5.71839 6 5.84557 5.94732 5.93934 5.85355L7.29289 4.5L5.93934 3.14645C5.84557 3.05268 5.71839 3 5.58579 3H3.5C2.67157 3 2 3.67157 2 4.5ZM1 4.5C1 3.11929 2.11929 2 3.5 2H5.58579C5.98361 2 6.36514 2.15804 6.64645 2.43934L8.20711 4H12.5C13.8807 4 15 5.11929 15 6.5V7.25716C14.6929 7.00353 14.3578 6.78261 14 6.59971V6.5C14 5.67157 13.3284 5 12.5 5H8.20711L6.64645 6.56066C6.36514 6.84197 5.98361 7 5.58579 7H2V11.5C2 12.3284 2.67157 13 3.5 13H6.20703C6.30564 13.3486 6.43777 13.6832 6.59971 14H3.5C2.11929 14 1 12.8807 1 11.5V4.5ZM16 11.5C16 13.9853 13.9853 16 11.5 16C9.01472 16 7 13.9853 7 11.5C7 9.01472 9.01472 7 11.5 7C13.9853 7 16 9.01472 16 11.5ZM12 9C12 8.72386 11.7761 8.5 11.5 8.5C11.2239 8.5 11 8.72386 11 9V11H9C8.72386 11 8.5 11.2239 8.5 11.5C8.5 11.7761 8.72386 12 9 12H11V14C11 14.2761 11.2239 14.5 11.5 14.5C11.7761 14.5 12 14.2761 12 14V12H14C14.2761 12 14.5 11.7761 14.5 11.5C14.5 11.2239 14.2761 11 14 11H12V9Z"/>',
    "reload": '<path d="M3 8C3 5.23858 5.23858 3 8 3C9.63527 3 11.0878 3.78495 12.0005 5H10C9.72386 5 9.5 5.22386 9.5 5.5C9.5 5.77614 9.72386 6 10 6H12.8904C12.8973 6.00014 12.9041 6.00014 12.911 6H13C13.2761 6 13.5 5.77614 13.5 5.5V2.5C13.5 2.22386 13.2761 2 13 2C12.7239 2 12.5 2.22386 12.5 2.5V4.03138C11.4009 2.78613 9.79253 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.1301 14 13.6999 11.6035 13.9756 8.54488C14.0003 8.26985 13.7975 8.0268 13.5225 8.00202C13.2474 7.97723 13.0044 8.1801 12.9796 8.45512C12.75 11.003 10.6079 13 8 13C5.23858 13 3 10.7614 3 8Z"/>',
    "collapse-all": '<path d="M14 4.27051C14.5999 4.62053 15 5.26009 15 6V11C15 13.21 13.21 15 11 15H6C5.26009 15 4.62053 14.5999 4.27051 14H11C12.65 14 14 12.65 14 11V4.27051Z"/><path d="M9.5 7C9.776 7 10 7.224 10 7.5C10 7.776 9.776 8 9.5 8H5.5C5.224 8 5 7.776 5 7.5C5 7.224 5.224 7 5.5 7H9.5Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11 2C12.103 2 13 2.897 13 4V11C13 12.103 12.103 13 11 13H4C2.897 13 2 12.103 2 11V4C2 2.897 2.897 2 4 2H11ZM4 3C3.449 3 3 3.449 3 4V11C3 11.552 3.449 12 4 12H11C11.551 12 12 11.552 12 11V4C12 3.449 11.551 3 11 3H4Z"/>',
    "case-sensitive": '<path fill-rule="evenodd" clip-rule="evenodd" d="M4.02602 3.34176C4.16218 2.93404 4.83818 2.93398 4.97426 3.34176L6.97426 9.34274C6.97526 9.34674 6.97817 9.35544 6.97817 9.35544L7.97426 12.3427C8.06126 12.6047 7.91984 12.8875 7.65786 12.9756C7.60486 12.9926 7.55165 13.0009 7.49965 13.0009C7.29082 13.0008 7.09602 12.868 7.02602 12.6591L6.14028 10.0009H2.86L1.97426 12.6591C1.88728 12.919 1.60634 13.0634 1.34243 12.9746C1.08043 12.8866 0.93902 12.6038 1.02602 12.3418L2.02211 9.35544C2.02311 9.35144 2.02602 9.34274 2.02602 9.34274L4.02602 3.34176ZM3.19399 8.99997H5.80629L4.49965 5.08102L3.19399 8.99997Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11.8581 6.66794C13.165 6.73296 13.9427 7.48427 13.9967 8.69626L13.9997 8.83297V12.5078C13.9957 12.7568 13.809 12.9621 13.568 12.9951L13.4997 13C13.2469 12.9998 13.0376 12.8121 13.0045 12.5683L12.9997 12.5V12.4297C12.3407 12.8066 11.7316 13 11.1666 13C9.94081 12.9998 8.99965 12.1369 8.99965 10.833C8.99967 9.68299 9.79211 8.82889 11.1061 8.66989C11.7279 8.59493 12.3589 8.64164 12.9987 8.80954C12.9915 8.07194 12.6279 7.70704 11.8082 7.66598C11.1672 7.63398 10.7158 7.72415 10.4518 7.90915C10.2258 8.06799 9.91347 8.01301 9.75551 7.78708C9.59671 7.56115 9.65178 7.24878 9.87758 7.09079C10.3165 6.78283 10.9138 6.64715 11.6666 6.6611L11.8581 6.66794ZM12.7965 9.8154C12.2587 9.66749 11.7361 9.62551 11.2262 9.68747C10.4042 9.78747 9.99868 10.2244 9.99868 10.8574C9.99884 11.5881 10.474 12.0242 11.1657 12.0244C11.6196 12.0244 12.1777 11.8137 12.8336 11.3818L12.9987 11.2695V9.87594L12.7965 9.8154Z"/>',
    "whole-word": '<path d="M15.5 12.5C15.776 12.5 16 12.724 16 13V13.5C16 14.327 15.327 15 14.5 15H1.5C0.673 15 0 14.327 0 13.5V13C0 12.724 0.224 12.5 0.5 12.5C0.776 12.5 1 12.724 1 13V13.5C1 13.775 1.224 14 1.5 14H14.5C14.776 14 15 13.775 15 13.5V13C15 12.724 15.224 12.5 15.5 12.5Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M4.8584 5.6709C6.16516 5.73603 6.94308 6.48734 6.99707 7.69922L7 7.83594V11.5107C6.996 11.7596 6.80919 11.9649 6.56836 11.998L6.5 12.0029C6.24709 12.0029 6.038 11.8152 6.00488 11.5713L6 11.5029V11.4326C5.341 11.8096 4.73199 12.0029 4.16699 12.0029C2.941 12.0029 2 11.1399 2 9.83594C2.00003 8.68597 2.79247 7.83185 4.10645 7.67285C4.7283 7.59793 5.35918 7.64552 5.99902 7.81348C5.99202 7.07548 5.62762 6.70995 4.80762 6.66895C4.16686 6.637 3.7161 6.72717 3.45215 6.91211C3.22615 7.07111 2.91386 7.01604 2.75586 6.79004C2.5969 6.56404 2.65194 6.25174 2.87793 6.09375C3.31692 5.78579 3.91404 5.65006 4.66699 5.66406L4.8584 5.6709ZM5.79688 8.81836C5.25888 8.67037 4.73558 8.62843 4.22559 8.69043C3.40389 8.79054 2.99902 9.22747 2.99902 9.86035C2.99917 10.5911 3.47413 11.0273 4.16602 11.0273C4.62001 11.0273 5.17799 10.8168 5.83398 10.3848L5.99902 10.2725V8.87891L5.79688 8.81836Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M9.55078 2.00586C9.78578 2.02986 9.97307 2.21715 9.99707 2.45215C10 2.46907 10 2.48601 10 2.50293V6.60254C10.418 6.22566 10.9371 6.00293 11.5 6.00293C12.881 6.00293 14 7.34596 14 9.00293C14 10.6599 12.881 12.0029 11.5 12.0029C10.9371 12.0029 10.418 11.7802 10 11.4033V11.5029C10 11.7619 9.80278 11.974 9.55078 12C9.53385 12.003 9.51693 12.0029 9.5 12.0029C9.224 12.0029 9 11.7789 9 11.5029V2.50293C9 2.486 9.00095 2.46907 9.00293 2.45215C9.02793 2.20015 9.241 2.00293 9.5 2.00293C9.51692 2.00293 9.53386 2.00388 9.55078 2.00586ZM11.4355 7.00391C11.0307 7.03208 10.5769 7.31545 10.29 7.82227C10.1232 8.12611 10.018 8.49479 10.002 8.89453C9.99995 8.92952 10 8.96597 10 9.00195C10 9.03795 10.001 9.07438 10.002 9.10938C10.018 9.50814 10.1222 9.87582 10.2891 10.1797C10.576 10.6875 11.0307 10.9728 11.4355 11C11.4565 11.002 11.478 11.002 11.5 11.002C11.522 11.002 11.5435 11.001 11.5645 11C11.9693 10.9728 12.424 10.6875 12.7109 10.1797C12.8778 9.87582 12.982 9.50814 12.998 9.10938C13 9.07438 13 9.03795 13 9.00195C13 8.96597 12.999 8.92952 12.998 8.89453C12.982 8.49479 12.8768 8.12611 12.71 7.82227C12.4231 7.31545 11.9693 7.03109 11.5645 7.00391C11.5435 7.00191 11.522 7.00195 11.5 7.00195C11.478 7.00195 11.4565 7.00291 11.4355 7.00391Z"/>',
    "regex": '<path d="M11.498 5H9.705L10.973 3.732C11.168 3.537 11.168 3.22 10.973 3.025C10.778 2.83 10.461 2.83 10.266 3.025L8.998 4.293V2.5C8.998 2.224 8.774 2 8.498 2C8.222 2 7.998 2.224 7.998 2.5V4.293L6.73 3.025C6.535 2.83 6.218 2.83 6.023 3.025C5.828 3.22 5.828 3.537 6.023 3.732L7.291 5H5.498C5.222 5 4.998 5.224 4.998 5.5C4.998 5.776 5.222 6 5.498 6H7.291L6.023 7.268C5.828 7.463 5.828 7.78 6.023 7.975C6.121 8.073 6.249 8.121 6.377 8.121C6.505 8.121 6.633 8.072 6.731 7.975L7.999 6.707V8.5C7.999 8.776 8.223 9 8.499 9C8.775 9 8.999 8.776 8.999 8.5V6.707L10.267 7.975C10.365 8.073 10.493 8.121 10.621 8.121C10.749 8.121 10.877 8.072 10.975 7.975C11.17 7.78 11.17 7.463 10.975 7.268L9.707 6H11.5C11.776 6 12 5.776 12 5.5C12 5.224 11.776 5 11.5 5H11.498ZM5 12C5 12.552 4.552 13 4 13C3.448 13 3 12.552 3 12C3 11.448 3.448 11 4 11C4.552 11 5 11.448 5 12Z"/>',
    "replace": '<path fill-rule="evenodd" clip-rule="evenodd" d="M10 2.813C10.295 2.619 10.634 2.5 11 2.5C12.103 2.5 13 3.509 13 4.75C13 5.991 12.103 7 11 7C10.62 7 10.269 6.873 9.966 6.666C9.897 6.86 9.717 7 9.5 7C9.224 7 9 6.776 9 6.5V1.5C9 1.224 9.224 1 9.5 1C9.776 1 10 1.224 10 1.5V2.813ZM10 4.75C10 5.439 10.448 6 11 6C11.552 6 12 5.439 12 4.75C12 4.061 11.552 3.5 11 3.5C10.448 3.5 10 4.061 10 4.75Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M2 9H7C7.552 9 8 9.448 8 10V15C8 15.552 7.552 16 7 16H2C1.448 16 1 15.552 1 15V10C1 9.448 1.448 9 2 9ZM5.039 13.645C4.81 13.849 4.199 13.968 3.83 13.506C3.617 13.24 3.5 12.88 3.5 12.492C3.5 12.104 3.618 11.744 3.83 11.478C4.201 11.014 4.811 11.133 5.04 11.339C5.244 11.525 5.56 11.507 5.746 11.303C5.931 11.098 5.915 10.782 5.709 10.597C4.922 9.887 3.733 10.001 3.049 10.853C2.695 11.297 2.5 11.878 2.5 12.492C2.5 13.106 2.695 13.688 3.049 14.131C3.43 14.605 3.945 14.867 4.5 14.867C4.941 14.867 5.359 14.701 5.708 14.387C5.913 14.202 5.93 13.886 5.745 13.681C5.559 13.476 5.243 13.458 5.039 13.645Z"/><path d="M3.99998 4.5C3.99998 3.673 4.67298 3 5.49998 3H7.50198C7.77798 3 8.00198 3.224 8.00198 3.5C8.00198 3.776 7.77798 4 7.50198 4H5.50198C5.22598 4 5.00198 4.225 5.00198 4.5V6.293L6.14798 5.147C6.34298 4.952 6.65998 4.952 6.85498 5.147C7.04998 5.342 7.04998 5.659 6.85498 5.854L4.85498 7.854C4.75698 7.951 4.62898 8 4.50098 8C4.37298 8 4.24498 7.952 4.14698 7.854L2.14698 5.854C1.95198 5.659 1.95198 5.342 2.14698 5.147C2.34198 4.952 2.65898 4.952 2.85398 5.147L3.99998 6.293V4.5Z"/>',
    "replace-all": '<path d="M14 13V10C14 8.35 12.65 7 11 7H5.12L4.12 8H11C12.1 8 13 8.9 13 10V14C13.55 14 14 13.55 14 13Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M10.999 5.5V2.75C10.999 1.765 10.12 1.25 9.25 1.25C8.362 1.25 7.989 1.553 7.896 1.646C7.701 1.841 7.687 2.17 7.882 2.365C8.076 2.561 8.379 2.573 8.575 2.378C8.57462 2.37825 8.57506 2.37797 8.575 2.378C8.58734 2.36997 8.77165 2.25 9.249 2.25C9.279 2.25 9.999 2.256 9.999 2.75V3.056C9.795 3.023 9.551 3 9.249 3C7.936 3 7.249 3.754 7.249 4.5C7.249 5.246 7.936 6 9.249 6C9.621 6 9.91 5.937 10.144 5.851C10.235 5.943 10.36 6 10.499 6C10.775 6 10.999 5.776 10.999 5.5ZM9.25 4C9.622 4 9.856 4.038 10 4.074V4.811C9.907 4.885 9.697 5 9.25 5C8.601 5 8.25 4.742 8.25 4.5C8.25 4.258 8.601 4 9.25 4Z"/><path d="M5.001 13.074C4.857 13.038 4.623 13 4.251 13C3.602 13 3.251 13.258 3.251 13.5C3.251 13.742 3.602 14 4.251 14C4.698 14 4.908 13.885 5.001 13.811V13.074Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M12 15V10C12 9.448 11.552 9 11 9H2C1.448 9 1 9.448 1 10V15C1 15.552 1.448 16 2 16H11C11.552 16 12 15.552 12 15ZM4.251 10.25C5.121 10.25 6 10.765 6 11.75V14.5C6 14.776 5.776 15 5.5 15C5.361 15 5.236 14.943 5.145 14.851C4.911 14.937 4.622 15 4.25 15C2.937 15 2.25 14.246 2.25 13.5C2.25 12.754 2.937 12 4.25 12C4.552 12 4.796 12.023 5 12.056V11.75C5 11.256 4.28 11.25 4.25 11.25C3.78749 11.25 3.6007 11.3631 3.57831 11.3767C3.57688 11.3775 3.57612 11.378 3.576 11.378C3.38 11.573 3.077 11.561 2.883 11.365C2.688 11.17 2.702 10.841 2.897 10.646C2.99 10.553 3.363 10.25 4.251 10.25ZM8.33 11.611C8.117 11.877 8 12.237 8 12.625C8 13.013 8.117 13.373 8.33 13.639C8.699 14.101 9.31 13.982 9.539 13.778C9.743 13.591 10.059 13.609 10.245 13.814C10.43 14.019 10.414 14.335 10.208 14.52C9.86 14.834 9.442 15 9 15C8.445 15 7.929 14.739 7.549 14.264C7.195 13.82 7 13.239 7 12.625C7 12.011 7.195 11.429 7.549 10.986C8.233 10.134 9.422 10.02 10.209 10.73C10.414 10.915 10.431 11.231 10.246 11.436C10.06 11.64 9.744 11.658 9.54 11.472C9.311 11.266 8.701 11.147 8.33 11.611Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M14 6C15.103 6 16 4.991 16 3.75C16 2.509 15.103 1.5 14 1.5C13.634 1.5 13.295 1.619 13 1.813V0.5C13 0.224 12.776 0 12.5 0C12.224 0 12 0.224 12 0.5V5.5C12 5.776 12.224 6 12.5 6C12.717 6 12.897 5.86 12.966 5.666C13.269 5.873 13.62 6 14 6ZM14 2.5C14.552 2.5 15 3.061 15 3.75C15 4.439 14.552 5 14 5C13.448 5 13 4.439 13 3.75C13 3.061 13.448 2.5 14 2.5Z"/><path d="M1.99998 4.5C1.99998 3.673 2.67298 3 3.49998 3H5.50198C5.77798 3 6.00198 3.224 6.00198 3.5C6.00198 3.776 5.77798 4 5.50198 4H3.50198C3.22598 4 3.00198 4.225 3.00198 4.5V6.293L4.14798 5.147C4.34298 4.952 4.65998 4.952 4.85498 5.147C5.04998 5.342 5.04998 5.659 4.85498 5.854L2.85498 7.854C2.75698 7.951 2.62898 8 2.50098 8C2.37298 8 2.24498 7.952 2.14698 7.854L0.146982 5.854C-0.0480176 5.659 -0.0480176 5.342 0.146982 5.147C0.341982 4.952 0.658982 4.952 0.853982 5.147L1.99998 6.293V4.5Z"/>',
    "bold": '<path d="M4 3.1C4 2.5 4.5 2 5.1 2H8.1C10.2 2 11.5 3.4 11.5 5.4C11.5 6.3 11.2 7.4 10.8 8C11.6 8.6 12.2 9.2 12.2 10.5C12.2 13.2 10.1 14 8.6 14H5.1C4.5 14 4 13.5 4 12.9V3.1ZM6 9V12H8.4C9.1 12 9.9 11.5 9.9 10.5C9.9 9.5 9.1 9 8.4 9H6ZM6 7H8.2C9.1 7 9.7 6.3 9.7 5.5C9.7 4.7 9.1 4 8.3 4H6V7Z"/>',
    "italic": '<path d="M13 2.00014H7C6.72386 2.00014 6.5 2.22399 6.5 2.50014C6.5 2.77628 6.72386 3.00014 7 3.00014H9.47388L5.65575 13L3 13.0001C2.72386 13.0001 2.5 13.224 2.5 13.5001C2.5 13.7763 2.72386 14.0001 3 14.0001H5.98833C5.99606 14.0003 6.00378 14.0003 6.01148 14.0001H9C9.27614 14.0001 9.5 13.7763 9.5 13.5001C9.5 13.224 9.27614 13.0001 9 13.0001L6.72617 13L10.5443 3.00014H13C13.2761 3.00014 13.5 2.77628 13.5 2.50014C13.5 2.22399 13.2761 2.00014 13 2.00014Z"/>',
    "table": '<path d="M1 3.5C1 2.11929 2.11929 1 3.5 1H12.5C13.8807 1 15 2.11929 15 3.5V12.5C15 13.8807 13.8807 15 12.5 15H3.5C2.11929 15 1 13.8807 1 12.5V3.5ZM6 14H10V11L6 11V14ZM5 11H2V12.5C2 13.3284 2.67157 14 3.5 14H5V11ZM6 10L10 10V6L6 6V10ZM5 6H2V10H5V6ZM6 5L10 5V2H6V5ZM5 2H3.5C2.67157 2 2 2.67157 2 3.5V5H5V2ZM14 6H11V10H14V6ZM14 11H11V14H12.5C13.3284 14 14 13.3284 14 12.5V11ZM14 5V3.5C14 2.67157 13.3284 2 12.5 2H11V5H14Z"/>',
    "file-media": '<path d="M6 1C4.89543 1 4 1.89543 4 3V6H5V3C5 2.44772 5.44772 2 6 2H9V4.5C9 5.32843 9.67157 6 10.5 6H13V13C13 13.5523 12.5523 14 12 14H10.9646C10.9141 14.3531 10.8109 14.6891 10.6632 15H12C13.1046 15 14 14.1046 14 13V5.41421C14 5.01639 13.842 4.63486 13.5607 4.35355L10.6464 1.43934C10.3651 1.15804 9.98361 1 9.58579 1H6ZM12.7929 5H10.5C10.2239 5 10 4.77614 10 4.5V2.20711L12.7929 5ZM1 9.5C1 8.11929 2.11929 7 3.5 7H7.5C8.88071 7 10 8.11929 10 9.5V13.5C10 14.0095 9.84756 14.4835 9.5858 14.8787L6.56066 11.8536C5.97487 11.2678 5.02513 11.2678 4.43934 11.8536L1.4142 14.8787C1.15244 14.4835 1 14.0095 1 13.5V9.5ZM8 9.75C8 9.33579 7.66421 9 7.25 9C6.83579 9 6.5 9.33579 6.5 9.75C6.5 10.1642 6.83579 10.5 7.25 10.5C7.66421 10.5 8 10.1642 8 9.75ZM2.12131 15.5858C2.51652 15.8476 2.99046 16 3.5 16H7.5C8.00954 16 8.48348 15.8476 8.87869 15.5858L5.85355 12.5607C5.65829 12.3654 5.34171 12.3654 5.14645 12.5607L2.12131 15.5858Z"/>',
    "symbol-operator": '<path d="M7 4.5C7 4.776 6.776 5 6.5 5H5V6.5C5 6.776 4.776 7 4.5 7C4.224 7 4 6.776 4 6.5V5H2.5C2.224 5 2 4.776 2 4.5C2 4.224 2.224 4 2.5 4H4V2.5C4 2.224 4.224 2 4.5 2C4.776 2 5 2.224 5 2.5V4H6.5C6.776 4 7 4.224 7 4.5ZM9.5 5H13.5C13.776 5 14 4.776 14 4.5C14 4.224 13.776 4 13.5 4H9.5C9.224 4 9 4.224 9 4.5C9 4.776 9.224 5 9.5 5ZM6.854 9.146C6.659 8.951 6.342 8.951 6.147 9.146L4.501 10.792L2.855 9.146C2.66 8.951 2.343 8.951 2.148 9.146C1.953 9.341 1.953 9.658 2.148 9.853L3.794 11.499L2.148 13.145C1.953 13.34 1.953 13.657 2.148 13.852C2.343 14.047 2.66 14.047 2.855 13.852L4.501 12.206L6.147 13.852C6.342 14.047 6.659 14.047 6.854 13.852C7.049 13.657 7.049 13.34 6.854 13.145L5.208 11.499L6.854 9.853C7.049 9.658 7.049 9.341 6.854 9.146ZM10.75 9.5C10.75 9.914 11.086 10.25 11.5 10.25C11.914 10.25 12.25 9.914 12.25 9.5C12.25 9.086 11.914 8.75 11.5 8.75C11.086 8.75 10.75 9.086 10.75 9.5ZM13.5 11H9.5C9.224 11 9 11.224 9 11.5C9 11.776 9.224 12 9.5 12H13.5C13.776 12 14 11.776 14 11.5C14 11.224 13.776 11 13.5 11ZM11.5 12.75C11.086 12.75 10.75 13.086 10.75 13.5C10.75 13.914 11.086 14.25 11.5 14.25C11.914 14.25 12.25 13.914 12.25 13.5C12.25 13.086 11.914 12.75 11.5 12.75Z"/>'
  };

  // ../../../packages/core/src/ui/icons/glyphs.ts
  var STROKE_GLYPHS = {
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
    "book-open": '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    "file-text": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    paperclip: '<path d="M13.234 20.252 21 12.3"/><path d="m16 6-8.414 8.586a2 2 0 0 0 0 2.828 2 2 0 0 0 2.828 0l8.414-8.586a4 4 0 0 0 0-5.656 4 4 0 0 0-5.656 0l-8.415 8.585a6 6 0 1 0 8.486 8.486"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    "file-minus": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/>',
    "file-no-text": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h4"/><path d="M8 17h3"/><path d="m3 3 18 18"/>',
    edit: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    "panel-right": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    "panel-left": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    "folder-open": '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    "folder-plus": '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    "folder-move": '<path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1"/><path d="M2 13h10"/><path d="m9 16 3-3-3-3"/>',
    "open-to-side": '<path d="M8 19H5c-1 0-2-1-2-2V7c0-1 1-2 2-2h3"/><path d="M16 5h3c1 0 2 1 2 2v10c0 1-1 2-2 2h-3"/><line x1="12" x2="12" y1="4" y2="20"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    "cloud-off": '<path d="m2 2 20 20"/><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
    quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
    highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    note: '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    "git-compare": '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5V15a3 3 0 0 0 3 3h6.5"/><path d="M18 15.5V9a3 3 0 0 0-3-3H8.5"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
    upload: '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
    log: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h8"/><path d="M8 17h5"/>'
  };
  var FILLED_GLYPHS = {
    ...CODICON_GLYPHS,
    "chevron-up": `<g transform="rotate(180 8 8)">${CODICON_GLYPHS["chevron-down"]}</g>`,
    "chevron-left": `<g transform="rotate(180 8 8)">${CODICON_GLYPHS["chevron-right"]}</g>`
  };
  var LOGO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#0571df" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 5.5 16 12 8 18.5"/></svg>';

  // ../../../packages/core/src/ui/icons/icon.ts
  var STROKE_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
  var FILLED_ATTRS = 'viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"';
  function icon(name) {
    if (name === "logo") return LOGO_SVG;
    if (name in FILLED_GLYPHS) return `<svg ${FILLED_ATTRS}>${FILLED_GLYPHS[name]}</svg>`;
    return `<svg ${STROKE_ATTRS}>${STROKE_GLYPHS[name]}</svg>`;
  }

  // ../../../packages/core/src/ui/tokens/designToken.ts
  function token(value, light) {
    return light === void 0 ? { value } : { value, light };
  }

  // ../../../packages/core/src/ui/tokens/colorTokens.ts
  var COLOR_TOKENS = {
    bg: token("#1f1f1f", "#ffffff"),
    fg: token("#cccccc", "#3b3b3b"),
    desc: token("#9d9d9d", "#717171"),
    error: token("#f85149", "#a1260d"),
    link: token("#4daafc", "#005fb8"),
    focus: token("#0078d4", "#005fb8"),
    "editor-cursor": token("#ffffff", "#000000"),
    "editor-selection-bg": token("#264f78", "#add6ff"),
    "editor-inactive-selection-bg": token("#3a3d41", "#e5ebf1"),
    "sidebar-bg": token("#181818", "#f8f8f8"),
    "sidebar-border": token("#2b2b2b", "#e5e5e5"),
    "section-fg": token("#cccccc", "#3b3b3b"),
    "section-bg": token("#181818", "#f8f8f8"),
    "section-border": token("#2b2b2b", "#e5e5e5"),
    border: token("#2b2b2b", "#e5e5e5"),
    "border-soft": token("rgba(128, 128, 128, .2)", "rgba(128, 128, 128, .25)"),
    "border-faint": token("rgba(128, 128, 128, .07)", "rgba(128, 128, 128, .1)"),
    "widget-bg": token("#202020", "#f8f8f8"),
    "code-bg": token("#2b2b2b", "#f8f8f8"),
    "tab-active-border": token("#0078d4", "#005fb8"),
    "sash-hover": token("#0078d4", "#005fb8"),
    progress: token("#0078d4", "#005fb8"),
    "statusbar-bg": token("#181818", "#f8f8f8"),
    "statusbar-fg": token("#cccccc", "#3b3b3b"),
    "statusbar-hover": token("rgba(255, 255, 255, .12)", "rgba(0, 0, 0, .12)"),
    overlay: token("rgba(0, 0, 0, .3)", "rgba(0, 0, 0, .18)"),
    "list-hover": token("#2a2d2e", "#f2f2f2"),
    "list-active-bg": token("#04395e", "#e8e8e8"),
    "list-active-fg": token("#ffffff", "#000000"),
    "list-inactive-bg": token("#37373d", "#e4e6f1"),
    "list-drop-bg": token("#383b3d", "#d6ebff"),
    "list-focus-outline": token("#0078d4", "#005fb8"),
    "tree-guide": token("#585858", "#a9a9a9"),
    "menu-bg": token("#1f1f1f", "#ffffff"),
    "menu-fg": token("#cccccc", "#3b3b3b"),
    "menu-border": token("#454545", "#cecece"),
    "menu-selection-bg": token("#0078d4", "#005fb8"),
    "menu-selection-fg": token("#ffffff", "#ffffff"),
    "menu-separator": token("#454545", "#e5e5e5"),
    "button-bg": token("#0078d4", "#005fb8"),
    "button-fg": token("#ffffff", "#ffffff"),
    "button-hover": token("#026ec1", "#0258a8"),
    "button-soft-fg": token("#66b1f3", "#0c589f"),
    // Tints over the foreground and focus colours follow any host theme without a map entry.
    "button-soft-bg": token("color-mix(in srgb, var(--ls-focus) 16%, transparent)"),
    "button-soft-hover": token("color-mix(in srgb, var(--ls-focus) 24%, transparent)"),
    "row-rule": token("color-mix(in srgb, var(--ls-fg) 8%, transparent)"),
    "row-open": token("color-mix(in srgb, var(--ls-fg) 7%, transparent)"),
    "row-selected": token("color-mix(in srgb, var(--ls-focus) 15%, transparent)"),
    "button2-bg": token("#313131", "#e5e5e5"),
    "button2-fg": token("#cccccc", "#3b3b3b"),
    "button2-hover": token("#3c3c3c", "#cccccc"),
    "input-bg": token("#313131", "#ffffff"),
    "input-fg": token("#cccccc", "#3b3b3b"),
    "input-border": token("#3c3c3c", "#cecece"),
    "input-placeholder": token("#989898", "#767676"),
    "toolbar-hover": token("rgba(90, 93, 94, .31)", "rgba(184, 184, 184, .31)"),
    "toolbar-active": token("rgba(99, 102, 103, .31)", "rgba(166, 166, 166, .31)"),
    "badge-bg": token("#616161", "#cccccc"),
    "badge-fg": token("#f8f8f8", "#3b3b3b"),
    "kbd-fg": token("#cccccc", "#3b3b3b"),
    "kbd-bg": token("rgba(128, 128, 128, .17)", "rgba(221, 221, 221, .4)"),
    "kbd-border": token("rgba(51, 51, 51, .6)", "rgba(204, 204, 204, .4)"),
    "kbd-bottom": token("rgba(68, 68, 68, .6)", "rgba(187, 187, 187, .4)"),
    scrollbar: token("rgba(121, 121, 121, .4)", "rgba(100, 100, 100, .4)"),
    "scrollbar-hover": token("rgba(100, 100, 100, .7)", "rgba(100, 100, 100, .7)"),
    "scrollbar-active": token("rgba(191, 191, 191, .4)", "rgba(0, 0, 0, .6)"),
    blue: token("#3794ff", "#007acc"),
    yellow: token("#cca700", "#b89500"),
    green: token("#89d185", "#388a34"),
    "find-match": token("rgba(234, 92, 0, .33)"),
    warning: token("#cca700", "#bf8803"),
    "warning-bg": token("#352a05", "#f6f5d2"),
    "warning-border": token("#b89500", "#b89500")
  };
  var STATUS_TOKENS = {
    "status-unread": token("var(--ls-blue)"),
    "status-reading": token("#e5c07b", "#c9a227"),
    "status-done": token("#4ec994", "#2e9e6b")
  };
  var MARK_TOKENS = {
    "mark-err": token("#d9736d", "#a8483a"),
    "mark-warn": token("#c9ad4a", "#a8822f"),
    "mark-ok": token("#93c190", "#4d8a4a"),
    "mark-accent": token("#6ea3e0", "#3a78ad")
  };
  var FILE_TYPE_TOKENS = {
    "file-pdf": token("#d9837c", "#b84a42"),
    "file-md": token("#7d9fe0", "#4069b8"),
    "file-ref": token("#7d9fe0", "#4069b8"),
    "file-tex": token("#8cc27a", "#4a8a3a"),
    "file-typ": token("#4cc4c9", "#1f8a93"),
    "file-dir": token("#d2a865", "#946618")
  };
  var SHEET_TOKENS = {
    "sheet-light": token("#f4f3f0")
  };

  // ../../../packages/core/src/ui/icons/arcMark.ts
  var ARC_TONES = ["err", "warn", "ok", "accent"];
  var STATUS_ARC = { unread: ["accent", "none"], reading: ["accent", "half"], done: ["ok", "full"] };
  var ARC_TONE_COLORS = Object.fromEntries(
    ARC_TONES.map((tone) => {
      const { value, light } = MARK_TOKENS[`mark-${tone}`];
      return [tone, { dark: value, light: light ?? value }];
    })
  );
  var STROKE = 'fill="none" stroke="COLOUR" stroke-width="1.4" stroke-linecap="round"';
  var TRACK = '<circle cx="6" cy="6" r="5" stroke-opacity=".22"/>';
  var ARC = {
    none: "",
    half: '<path d="M6 1a5 5 0 0 1 0 10"/>',
    full: '<circle cx="6" cy="6" r="5"/>'
  };
  function markSvg(tone, body, colour, extraClass = "") {
    if (colour !== void 0) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-2 -2 16 16" ${STROKE.replace("COLOUR", colour)}>${body.replaceAll("COLOUR", colour)}</svg>`;
    }
    return `<svg class="ls-arc ls-arc-${tone}${extraClass}" viewBox="0 0 12 12" ${STROKE.replace("COLOUR", "currentColor")} aria-hidden="true" focusable="false">${body.replaceAll("COLOUR", "currentColor")}</svg>`;
  }
  function arcMark(tone, progress, colour) {
    return markSvg(tone, TRACK + ARC[progress], colour);
  }
  var DOT = '<circle cx="6" cy="6" r="3" fill="COLOUR" stroke="none"/>';
  function statusMark(status, colour) {
    const [tone, progress] = STATUS_ARC[status];
    return status === "unread" ? markSvg(tone, DOT, colour, " ls-status-dot") : arcMark(tone, progress, colour);
  }

  // ../../../packages/core/src/ui/dom/widgets/menu.ts
  var closeCurrent = null;
  function closeMenu() {
    closeCurrent?.();
  }
  function showMenu(anchor, entries, opts = {}) {
    closeMenu();
    const menu = el("div", { class: "ls-menu", role: "menu" });
    for (const entry of entries) {
      if (entry === "separator") {
        menu.append(el("div", { class: "ls-menu-sep", role: "separator" }));
        continue;
      }
      const item = el("button", {
        class: `ls-menu-item${entry.danger ? " danger" : ""}${entry.checked ? " checked" : ""}`,
        role: entry.checked === void 0 ? "menuitem" : entry.radio ? "menuitemradio" : "menuitemcheckbox",
        "aria-checked": entry.checked === void 0 ? void 0 : String(entry.checked),
        type: "button",
        disabled: entry.disabled ? true : void 0,
        html: `<span class="ls-menu-lead">${leadOf(entry)}</span><span class="ls-menu-label">${escapeHtml(entry.label)}</span>${entry.hint ? `<span class="hint">${escapeHtml(entry.hint)}</span>` : ""}`
      });
      item.addEventListener("click", () => {
        close();
        entry.onSelect();
      });
      menu.append(item);
    }
    const scrim = el("div", { class: "ls-scrim" });
    scrim.addEventListener("mousedown", close);
    scrim.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      close();
    });
    (opts.root ?? document.body).append(scrim, menu);
    const focusScope = opts.root ?? document;
    const point = anchor instanceof HTMLElement ? anchorPoint(anchor) : anchor;
    place(menu, point, anchor instanceof HTMLElement ? anchor.getBoundingClientRect().height : 0);
    const onKey = (e) => {
      const items = Array.from(menu.querySelectorAll(".ls-menu-item:not(:disabled)"));
      const idx = items.indexOf(focusScope.activeElement);
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(idx + 1) % items.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1]?.focus();
      } else if (e.key === "Tab") {
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey, true);
    menu.querySelector(".ls-menu-item:not(:disabled)")?.focus();
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      scrim.remove();
      menu.remove();
      if (closeCurrent === close) closeCurrent = null;
      opts.onClose?.();
    }
    closeCurrent = close;
  }
  function leadOf(entry) {
    if (entry.checked) return icon("check");
    return entry.icon ? icon(entry.icon) : entry.lead ?? "";
  }
  function anchorPoint(anchor) {
    const r = anchor.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 2 };
  }
  function place(menu, point, anchorHeight) {
    const pad = 6;
    const { width, height } = menu.getBoundingClientRect();
    let x = point.x;
    let y = point.y;
    if (x + width + pad > window.innerWidth) x = Math.max(pad, window.innerWidth - width - pad);
    if (y + height + pad > window.innerHeight) y = Math.max(pad, point.y - height - anchorHeight - 4);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }

  // ../../../packages/core/src/ui/dom/widgets/overlay.ts
  function mountOverlay(content, onDismiss, opts = {}) {
    const parent = opts.root ?? document.body;
    const scope = opts.root ?? document;
    const scrim = el("div", { class: "ls-scrim dim" });
    const previous = scope.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      } else if (e.key === "Tab") {
        trapFocus(e, content, scope);
      }
    };
    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      scrim.remove();
      content.remove();
      previous?.focus?.();
    };
    const dismiss = () => {
      close();
      onDismiss();
    };
    scrim.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", onKey, true);
    parent.append(scrim, content);
    return { close };
  }
  function trapFocus(e, root, scope) {
    const focusable = Array.from(root.querySelectorAll("input, button:not(:disabled), [tabindex]"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && scope.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && scope.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ../../../packages/core/src/ui/dom/widgets/dialog.ts
  function showDialog(opts) {
    return new Promise((resolve) => {
      const actions = el("div", { class: "ls-dialog-actions" });
      const glyph = opts.severity === "info" ? "info" : "warning";
      const box = el(
        "div",
        { class: "ls-dialog", role: "alertdialog", "aria-modal": "true" },
        el(
          "div",
          { class: "ls-dialog-head" },
          el("span", { html: icon(glyph) }),
          el(
            "div",
            {},
            el("div", { class: "ls-dialog-title", text: opts.title }),
            opts.message ? el("div", { class: "ls-dialog-msg", text: opts.message }) : null
          )
        ),
        actions
      );
      if (opts.severity === "danger") box.querySelector("svg")?.classList.add("danger");
      const { close } = mountOverlay(box, () => resolve(void 0), opts.root ? { root: opts.root } : {});
      const cancel = el("button", { class: "ls-btn", type: "button", text: "Cancel" });
      cancel.addEventListener("click", () => {
        close();
        resolve(void 0);
      });
      actions.append(cancel);
      let primary = null;
      for (const b of opts.buttons) {
        const btn = el("button", { class: `ls-btn${b.primary ? " ls-btn-primary" : ""}${b.danger ? " ls-btn-danger" : ""}`, type: "button", text: b.label });
        btn.addEventListener("click", () => {
          close();
          resolve(b.id);
        });
        actions.append(btn);
        if (b.primary) primary = btn;
      }
      (primary ?? cancel).focus();
    });
  }

  // ../../../packages/core/src/ui/dom/widgets/quickInput.ts
  function filterEntries(entries, toks) {
    const matches = (it) => toks.every((t) => `${it.label} ${it.description ?? ""}`.toLowerCase().includes(t));
    const kept = [];
    let heading;
    for (const entry of entries) {
      if ("kind" in entry) {
        heading = entry;
        continue;
      }
      if (!matches(entry)) continue;
      if (heading) {
        kept.push(heading);
        heading = void 0;
      }
      kept.push(entry);
    }
    return kept;
  }
  function quickPick(entries, opts = {}) {
    return new Promise((resolve) => {
      const input = el("input", { class: "ls-input", type: "text", placeholder: opts.placeholder ?? "", spellcheck: "false", autocomplete: "off" });
      const list = el("div", { class: "ls-quick-list", role: "listbox" });
      const box = el(
        "div",
        { class: "ls-quick", role: "dialog" },
        opts.title ? el("div", { class: "ls-quick-title", text: opts.title }) : null,
        input,
        list
      );
      const { close } = mountOverlay(box, () => resolve(void 0));
      let visible = [];
      let active = 0;
      const render = () => {
        const toks = input.value.toLowerCase().split(" ").filter(Boolean);
        const rows = filterEntries(entries, toks);
        visible = rows.filter((entry) => !("kind" in entry));
        active = Math.min(active, Math.max(0, visible.length - 1));
        list.innerHTML = visible.length === 0 ? `<div class="ls-quick-empty">No matching results</div>` : "";
        let index = 0;
        for (const entry of rows) {
          if ("kind" in entry) {
            list.append(el("div", { class: "ls-quick-sep", role: "presentation", text: entry.label }));
            continue;
          }
          const i = index++;
          const row = el("div", {
            class: `ls-quick-item${i === active ? " active" : ""}`,
            role: "option",
            html: `${entry.icon ? icon(entry.icon) : ""}<span class="label">${highlight(entry.label, toks)}</span>${entry.description ? `<span class="desc">${highlight(entry.description, toks)}</span>` : ""}`
          });
          row.addEventListener("mousemove", () => {
            if (active !== i) {
              active = i;
              paintActive();
            }
          });
          row.addEventListener("click", () => pick(i));
          list.append(row);
        }
      };
      const paintActive = () => {
        list.querySelectorAll(".ls-quick-item").forEach((r, i) => r.classList.toggle("active", i === active));
        list.querySelector(".ls-quick-item.active")?.scrollIntoView({ block: "nearest" });
      };
      const pick = (i) => {
        const it = visible[i];
        if (!it) return;
        close();
        resolve(it.value);
      };
      input.addEventListener("input", render);
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          active = Math.min(visible.length - 1, active + 1);
          paintActive();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          active = Math.max(0, active - 1);
          paintActive();
        } else if (e.key === "Enter") {
          e.preventDefault();
          pick(active);
        }
      });
      render();
      input.focus();
    });
  }
  function inputBox(opts = {}) {
    return new Promise((resolve) => {
      const input = el("input", { class: "ls-input", type: "text", value: opts.value ?? "", placeholder: opts.placeholder ?? "", spellcheck: "false", autocomplete: "off" });
      const msg = el("div", { class: "ls-quick-msg", text: opts.prompt ?? "" });
      const box = el(
        "div",
        { class: "ls-quick", role: "dialog" },
        opts.title ? el("div", { class: "ls-quick-title", text: opts.title }) : null,
        input,
        msg
      );
      const { close } = mountOverlay(box, () => resolve(void 0));
      const validate = () => {
        const error = opts.validate?.(input.value) ?? null;
        input.setAttribute("aria-invalid", error ? "true" : "false");
        msg.classList.toggle("error", !!error);
        msg.textContent = error ?? opts.prompt ?? "";
        return error;
      };
      input.addEventListener("input", validate);
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (validate()) return;
        close();
        resolve(input.value.trim());
      });
      input.focus();
      input.select();
    });
  }

  // ../../../packages/core/src/ui/dom/widgets/toast.ts
  var AUTO_DISMISS_MS = 4500;
  var host = null;
  function toast(message, kind = "info") {
    if (!host) {
      host = el("div", { class: "ls-toasts", role: "status", "aria-live": "polite" });
      document.body.append(host);
    }
    const glyph = kind === "error" ? "warning" : kind === "ok" ? "check" : "info";
    const closeBtn = el("button", { class: "ls-icon-btn", type: "button", title: "Dismiss", html: icon("x") });
    const node = el(
      "div",
      { class: `ls-toast ${kind}`, role: kind === "error" ? "alert" : null },
      el("span", { html: icon(glyph) }),
      el("div", { class: "msg", text: message }),
      closeBtn
    );
    const dismiss = () => {
      node.remove();
    };
    closeBtn.addEventListener("click", dismiss);
    host.append(node);
    if (kind !== "error") setTimeout(dismiss, AUTO_DISMISS_MS);
    return dismiss;
  }
  return __toCommonJS(core_exports);
})();
