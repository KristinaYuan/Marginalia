// ==UserScript==
// @name         Marginalia
// @namespace    https://github.com/KristinaYuan/Marginalia
// @version      0.1.0
// @description  Highlight, annotate, and revisit the web — a local-first reading companion. Highlight text, attach sticky notes, and browse everything in a unified Library.
// @author       Kristina
// @homepageURL  https://github.com/KristinaYuan/Marginalia
// @supportURL   https://github.com/KristinaYuan/Marginalia
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-idle
// @noframes
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB4PSI0IiB5PSI0IiB3aWR0aD0iNTYiIGhlaWdodD0iNTYiIHJ4PSIxMiIgZmlsbD0iI2Y1ZDk3OCIvPjxwYXRoIGQ9Ik0yMCAyMGgyNHYyNEgyMHoiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9Ii45Ii8+PHBhdGggZD0iTTI4IDI2aDhsMyAwdjEybC0zLTRoLThsLTMtNHoiIGZpbGw9IiMyYzJhMjYiLz48L3N2Zz4=
// ==/UserScript==

/**
 * Marginalia — a cross-browser web highlighting & annotation tool.
 *
 * Layered architecture (per the project brief):
 *   - Compat layer   : storage / menu / clipboard / style-injection abstraction.
 *   - Data model     : Article, Highlight, Note (embedded), Tag.
 *   - Storage layer  : GM_getValue/GM_setValue with a localStorage fallback.
 *   - Annotation eng.: text anchors (quote + prefix/suffix), DOM wrapping, restore.
 *   - UI layer       : selection toolbar, sticky notes, context menu, Library,
 *                      import/export, settings.
 *
 * The UI chrome (toolbar, Library, context menu, floating button) lives inside a
 * Shadow DOM so page styles cannot leak into it. Highlights and sticky notes live
 * in the light DOM because they must anchor to real page content/document
 * coordinates. All app-owned elements are namespaced with `marginalia-`.
 */
(function () {
  'use strict';

  // Guard against double injection (duplicated install, SPA re-injection, iframes).
  if (window.__marginaliaLoaded) return;
  window.__marginaliaLoaded = true;
