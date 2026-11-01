# Project Brief: A Cross-browser Web Highlighting & Annotation Tool

## 1. Project Overview

Build a lightweight, elegant, cross-browser web annotation tool that allows users to highlight text, attach notes, create floating page notes, and manage all their annotations in a unified personal Library.

The tool should run as a **single, reusable UserScript (`.user.js`)**, installed through Tampermonkey or a compatible userscript manager.

The primary goal is to make reading, highlighting, and collecting thoughts on the web feel as natural as annotating a physical book.

This is a local-first personal tool, not a social platform or a full-fledged knowledge management system.

### Core principles

- Lightweight and unobtrusive.
- Local-first: no account, backend, server, API key, or external service required.
- Cross-browser: aim to support Safari, Chrome, Firefox, and Microsoft Edge through one common UserScript.
- Elegant editorial visual design.
- Reliable persistence of annotations across page reloads and revisits.
- Easy data backup, restoration, and migration.
- Preserve the original website's appearance and functionality as much as possible.

Do not introduce unnecessary features, complex integrations, AI functionality, knowledge graphs, or cloud synchronization.

---

## 2. Technical Architecture and Compatibility

### 2.1 Delivery format

The final product should be distributed as one `.user.js` file.

Users should be able to install the same script in different browsers using Tampermonkey or another compatible userscript manager.

Do NOT build:
- A standalone Safari extension.
- Separate browser-specific extensions.
- A standalone desktop application.
- A backend service.

### 2.2 Cross-browser architecture

Use standard JavaScript, HTML, and CSS for the core application logic.

Separate browser/userscript-manager-specific functionality into a small compatibility layer, including:

- Persistent storage.
- Menu registration.
- Clipboard operations.
- Styling injection, if necessary.
- Other userscript-manager-specific APIs.

Use feature detection and graceful fallbacks wherever possible.

Before implementation, investigate the current compatibility and limitations of the target userscript managers on Safari, Chrome, Firefox, and Edge.

In particular, verify:
- UserScript metadata requirements.
- Available GM APIs and their differences.
- Storage behavior and permissions.
- Script injection restrictions.
- SPA navigation and content-script behavior.
- Potential differences in selection, context-menu, and DOM APIs.

Do not assume that all browsers or userscript managers expose identical APIs.

If a requested behavior cannot be implemented consistently across browsers, document the limitation and provide the closest practical fallback rather than silently dropping the feature.

### 2.3 Storage

Use userscript-manager persistent storage APIs where available, such as `GM_getValue` and `GM_setValue`, with an appropriate compatibility abstraction.

Avoid relying on ordinary page `localStorage` as the only storage mechanism, because the script should not be tightly coupled to the website's storage environment.

Keep the following layers separate:

1. Data Model: canonical application data structures.
2. Storage Layer: persistence and retrieval.
3. Import/Export Layer: data serialization and format conversion.
4. UI Layer: Library, floating toolbar, notes, and settings.
5. Annotation Engine: text selection, DOM highlighting, and anchor restoration.

The core application should not depend directly on a specific browser's storage API.

---

## 3. Data Model

Use JSON as the canonical internal data format.

The data model should distinguish between Articles, Highlights, and Notes.

### 3.1 Article

An Article represents a webpage.

Suggested fields:

- `id`: stable unique identifier.
- `url`: canonical article URL.
- `title`: page title.
- `domain`: website domain.
- `favicon`: optional website icon information.
- `createdAt`: first recorded timestamp.
- `updatedAt`: latest modification timestamp.
- `articleNote`: optional independent Article Note reference or content.
- `favorite`: boolean.
- `visibilitySettings`: optional per-article display preferences.

An Article can exist without any Highlights if the user creates only an Article Note.

Multiple Highlights from the same article should belong to the same Article record.

Implement sensible URL normalization to avoid duplicate Article records caused by tracking parameters, fragments, or other irrelevant URL differences.

However, do not normalize so aggressively that genuinely different articles are merged.

### 3.2 Highlight

Each Highlight is an independent record.

Suggested fields:

- `id`
- `articleId`
- `url`
- `title`
- `text`: exact selected text.
- `style`: marker, underline, wavy underline, or dotted underline.
- `color`: one of the five predefined colors.
- `note`: optional associated Highlight Note.
- `tags`: array of tag IDs or names.
- `favorite`: boolean.
- `createdAt`
- `updatedAt`
- `anchor`: text-position information.
- `notePosition`: optional UI position information.

Each Highlight must preserve its own text, style, color, note, tags, and favorite status.

Multiple Highlights may overlap in the original text. They must remain independent records unless the user explicitly chooses to modify an existing annotation.

### 3.3 Text anchors

Do not rely exclusively on DOM node positions or serialized DOM paths.

Store robust text quote anchors, including:

- `exact`: exact selected text.
- `prefix`: text immediately preceding the selection.
- `suffix`: text immediately following the selection.

Additional position information may be stored as a fallback.

On subsequent visits, attempt to locate the original text using the quote anchor.

If the page structure changes:
- Attempt to restore the annotation using its text and surrounding context.
- Avoid attaching the annotation to an incorrect passage.
- If reliable restoration is impossible, mark it as unresolved rather than silently placing it elsewhere.

### 3.4 Notes

There are two distinct note types:

**Highlight Note**
- Associated with one specific Highlight.
- Stores its own text and visual position.
- Can be independently edited, moved, collapsed, and recolored.

**Article Note**
- Independent of any Highlight.
- Associated with an Article.
- Can contain general reading thoughts, summaries, or personal reflections.
- Uses the same sticky-note visual system as Highlight Notes.
- Defaults to the upper-right area of the webpage.

### 3.5 Tags

Tags should be freely created by users.

Requirements:
- One Highlight can have multiple tags.
- Provide autocomplete based on existing tags.
- Allow creating, renaming, and deleting tags.
- Clicking a tag filters relevant records.
- Do not impose predefined categories or hierarchical tag structures.

### 3.6 Favorites

Articles and Highlights can be favorited independently.

Favorite status must not be tied to colors or tags.

Provide separate ways to browse favorite Articles and favorite Highlights.

---

## 4. Highlighting Interaction

### 4.1 Text selection toolbar

When a user selects text on a webpage, display a small contextual floating toolbar near the selection.

The interaction should feel similar to the contextual "Ask ChatGPT" toolbar that appears after selecting text.

The toolbar should:
- Appear close to the selected text.
- Avoid being clipped by viewport boundaries.
- Remain usable when the user interacts with its controls.
- Disappear appropriately when the selection is dismissed or the user clicks elsewhere.
- Avoid interfering with normal text selection and webpage interactions.

Suggested toolbar actions:

1. Highlight: choose annotation style and color.
2. Note: create a Highlight Note.
3. More: additional actions such as copy, favorite, and annotation management.

The Highlight action should provide an intuitive way to choose both style and color.

### 4.2 Highlight styles

Support four styles:

- Marker: translucent background highlight.
- Underline: solid underline.
- Wavy underline.
- Dotted underline.

Style and color must be independent properties.

All five predefined colors should be available for all four styles.

Use CSS-based rendering where practical, while preserving the original text layout and avoiding changes to the underlying page content.

### 4.3 Highlight colors

Use the following five colors as the default palette:

| Name | Hex |
|---|---|
| Butter | `#F5D978` |
| Sky | `#A9C9EE` |
| Lilac | `#C5B1E8` |
| Rose | `#ECAEBB` |
| Sage | `#A9D4B5` |

These colors have no predefined semantic meaning.

Marker highlights should use appropriate transparency so that text remains readable.

### 4.4 Overlapping Highlights

When a newly selected range overlaps an existing Highlight, ask the user how to proceed.

Provide three choices:

**Modify existing annotation**
- Update the selected existing Highlight rather than creating a duplicate.
- Preserve its Note, tags, favorite status, and other unrelated metadata.
- If multiple existing annotations overlap, allow the user to identify which one they intend to modify.

**Create independent annotation**
- Create a separate Highlight record.
- Allow overlapping or even identical text ranges.
- Preserve each annotation's independent style, color, and Note.

**Cancel**
- Make no changes.

Never silently overwrite, merge, or delete existing annotations.

---

## 5. Sticky Notes

Use a visual style inspired by the native macOS Stickies application.

Notes should feel like small floating pieces of paper placed over the webpage.

### 5.1 Appearance

- Soft, solid pastel backgrounds.
- Subtle shadow.
- Clean typography.
- Minimal editing controls.
- A simple `...` menu for secondary actions.
- Fixed dimensions; users cannot resize notes.

Use the same visual language for Highlight Notes and Article Notes.

### 5.2 Behavior

Notes should:
- Be freely draggable.
- Support expanding and collapsing.
- Become a small note icon when collapsed.
- Allow direct text editing.
- Have independently selectable background colors.
- Preserve their text, position, and expanded/collapsed state.
- Avoid obscuring important content unnecessarily.

### 5.3 Positioning modes

Support two positioning modes:

**Anchored to page**
- The note is positioned relative to the webpage's document coordinates.
- It moves naturally with the page when scrolling.
- This is the default mode for Highlight Notes.

**Floating**
- The note stays at a fixed position relative to the browser viewport.
- It does not move with page scrolling.

Both modes support dragging.

Save each note's positioning mode and position so that it can be restored when the user revisits the Article.

Article Notes default to the upper-right area of the page, but can be moved freely.

### 5.4 Note navigation

When a Highlight Note is associated with a Highlight, provide a way to navigate to the associated original text.

Clicking the relevant reference or navigation action should scroll to the associated passage when it can be located.

---

## 6. Article Note Context Menu

Users should be able to create an independent Article Note by right-clicking anywhere on a webpage.

Since ordinary UserScripts cannot directly inject arbitrary entries into the browser's native context menu, implement a lightweight custom webpage context menu.

Include an action such as:

"Add Page Note"

The custom menu should:
- Appear near the pointer.
- Avoid viewport clipping.
- Match the application's visual style.
- Allow the user to create an Article Note immediately.

Also provide a way to open the Library.

Do not interfere with text selection, form controls, links, or other essential website interactions unnecessarily.

Provide a practical way to access the native browser context menu when needed, such as a configurable modifier-key behavior or an application setting.

Do not replace the native context menu more aggressively than necessary.

---

## 7. Library

The Library is the central interface for browsing and managing all saved content.

Use a **sidebar-based layout combined with elegant editorial-style content cards**.

### 7.1 Navigation

Provide the following views:

- All Highlights
- Articles
- Highlights
- Notes
- Favorites
- Tags

Include a search field near the top.

### 7.2 Content presentation

Use a clean card-based layout.

Highlight cards should display:
- Selected text.
- Highlight style and color.
- Associated Note, if any.
- Source Article title.
- Creation or modification date.
- Relevant tags.
- Favorite status.

Article cards should display:
- Article title.
- Domain or website information.
- Article Note, if available.
- Number of associated Highlights.
- Favorite status.

Allow users to expand an Article to browse its associated Highlights and Notes.

All Highlights should also be browsable independently, without requiring users to open their parent Articles.

### 7.3 Search and filtering

Provide practical search across:
- Highlight text.
- Highlight Notes.
- Article Notes.
- Article titles.
- Tags.

Allow filtering by tags and favorites.

### 7.4 Preview and navigation

When a user clicks a Highlight in the Library:

- Allow the record to expand in the Library to show its content and available context.
- Provide an explicit "Open in page" action.
- When opening the original webpage, attempt to navigate to the corresponding text anchor.
- Briefly emphasize the located text to help the user recognize it.

If the original webpage is unavailable, retain and display the saved text and notes.

The Library should remain useful independently of the availability of the original webpage.

### 7.5 Access

Provide a convenient way to open and close the Library, such as a userscript-manager menu command and an in-page application entry point.

The Library should be implemented as a self-contained interface that does not interfere with the original website.

---

## 8. Visibility Controls and Clean Mode

Provide independent visibility controls for different annotation elements.

Users should be able to control:

1. Highlights: marker, underline, wavy underline, and dotted underline.
2. Sticky Notes: both Highlight Notes and Article Notes.
3. Floating Toolbar: the contextual selection toolbar.

Provide two convenient presets:

**Full View**
- Show all annotations and application controls.

**Clean View**
- Hide all Highlights.
- Hide all Sticky Notes.
- Hide the Floating Toolbar.

Users should also be able to control each visibility setting independently.

Important requirements:

- Hiding an element must never delete or modify its underlying data.
- Restoring visibility should restore the original annotation appearance and note states.
- Visibility settings should be remembered per Article.
- The Library should remain accessible in Clean View.
- Clean View should not modify or remove the original webpage's content.

Implement a convenient toggle for Clean View, preferably with a configurable keyboard shortcut.

Avoid conflicts with common browser and website shortcuts.

---

## 9. Visual Design

### 9.1 Overall direction

The visual direction is **Editorial**.

The interface should feel like a personal reading archive or a beautifully typeset reading journal.

It should combine:
- The warmth and atmosphere of editorial and literary publications.
- The clarity and organization of modern productivity applications.
- A restrained use of soft pastel colors.

Avoid:
- Generic dashboard aesthetics.
- Excessive rounded cards.
- Heavy borders and shadows.
- Overly decorative illustrations.
- Crowded interfaces.
- Excessive animations.
- Excessive gray or muddy colors.

### 9.2 Typography

Use a tasteful combination of:

- Serif typography for prominent headings and editorial elements.
- Clean sans-serif typography for navigation, controls, metadata, and general UI text.

Choose fonts that are practical and available across platforms, with sensible system fallbacks.

### 9.3 Color and surfaces

Use a warm paper-white background in light mode rather than harsh pure white.

Use the five predefined pastel colors as the primary accent palette.

Prefer generous whitespace, subtle dividers, and restrained visual hierarchy.

### 9.4 Theme

Support three appearance settings:

- System: follow the operating system's light/dark appearance.
- Light: force light mode.
- Dark: force dark mode.

System should be the default.

The theme setting should affect the application's UI without changing the original webpage's appearance.

Sticky Note colors should remain independently selectable and maintain sufficient text contrast in both themes.

### 9.5 Webpage integration

The application's visual style should be distinguishable from the original website without feeling intrusive.

- Keep annotation controls lightweight.
- Avoid modifying the website's layout.
- Use isolated styles and appropriately scoped DOM elements.
- Prevent CSS collisions with website styles.
- Ensure annotation overlays have sensible stacking behavior.
- Do not obscure page content unnecessarily.

---

## 10. Data Import and Export

Support four export formats.

### JSON
- Complete backup and restoration.
- Preserve all Article, Highlight, Note, tag, favorite, position, and relevant metadata.
- Use a versioned schema.

### Markdown
- Human-readable notes.
- Organize content by Article.
- Include source URLs, selected text, notes, tags, and timestamps where available.
- Suitable for Obsidian and other Markdown-based workflows.

### CSV
- Suitable for Excel and data analysis.
- Provide a practical representation of Highlights and their metadata.
- Handle multiple tags consistently.

### HTML
- Generate a browsable archive of saved content.
- Preserve useful formatting and source links.
- Do not require a server to view the exported archive.

### Import behavior

Support two modes:

**Replace All**
- Replace the current Library with the imported dataset.
- Intended for full backup restoration.
- Require clear confirmation before destructive replacement.

**Merge**
- Merge imported records into the current dataset.
- Use stable IDs to identify duplicates.
- If records with the same ID have conflicting content, notify the user and do not silently overwrite either version.

Validate imported files and handle malformed data gracefully.

Keep the internal JSON model independent of the presentation formats.

---

## 11. Persistence and Error Handling

The application should remain reliable across page reloads, browser restarts, and revisits.

Persist:
- Articles.
- Highlights.
- Notes.
- Tags.
- Favorites.
- Note positions and positioning modes.
- Expanded/collapsed note states.
- Relevant visibility preferences.
- Theme preference.

Important edge cases:

**Page unavailable or deleted**
- Keep all saved records in the Library.
- Do not delete historical content automatically.

**Original text changed**
- Attempt anchor restoration using exact text and surrounding context.
- Mark unresolved annotations when reliable restoration is impossible.

**Duplicate Article detection**
- Normalize URLs carefully.
- Avoid creating unnecessary duplicate Article records.

**Duplicate imports**
- Use stable IDs.
- Handle conflicts explicitly.

**DOM changes**
- Avoid duplicate initialization.
- Ensure annotation rendering is idempotent.

**Single-page applications**
- Detect URL changes and relevant navigation events.
- Reinitialize or update the application state when necessary.
- Observe DOM changes carefully without creating excessive performance overhead.

**Deletion**
- Provide an appropriate confirmation or undo mechanism for destructive actions.
- Never silently delete related records when deleting an Article or Highlight.

---

## 12. Performance and Robustness

The tool should remain lightweight, even on long articles and pages with complex DOM structures.

Requirements:

- Avoid unnecessarily scanning the entire DOM repeatedly.
- Use efficient text-node traversal and range handling.
- Minimize MutationObserver overhead.
- Prevent infinite observer loops caused by the application's own DOM modifications.
- Avoid interfering with dynamically updated content.
- Keep annotation rendering and application UI isolated.
- Handle pages with unusual structures gracefully.
- Avoid modifying form controls, editable regions, or other sensitive interactive areas.

If a webpage cannot be annotated reliably, fail gracefully and preserve the user's existing data.

---

## 13. MVP Scope and Priorities

Prioritize implementation in this order.

### Phase 1: Core annotation

- Text selection toolbar.
- Four Highlight styles.
- Five predefined colors.
- Highlight persistence.
- Robust text anchors.
- Overlap handling.
- Highlight Notes.
- Article Notes.
- Basic note dragging and positioning.

### Phase 2: Library

- Sidebar-based Library.
- Article and Highlight views.
- Notes and Favorites.
- Tags.
- Search and filtering.
- Navigation back to original text.

### Phase 3: Reading experience

- Clean View and Full View.
- Independent visibility controls.
- Keyboard shortcut.
- System/light/dark themes.
- UI refinements.

### Phase 4: Data portability and compatibility

- JSON, Markdown, CSV, and HTML export.
- JSON import with Replace All and Merge.
- Cross-browser compatibility testing.
- Error handling and performance optimization.

The phases indicate development priorities, not permission to omit previously specified functionality from the intended product.

---

## 14. Explicit Non-goals

Do not implement the following unless explicitly requested later:

- User accounts.
- Cloud storage or synchronization.
- Social sharing.
- Collaboration.
- AI-generated summaries or recommendations.
- Automatic semantic tagging.
- Knowledge graphs.
- Full-text crawling or indexing of entire websites.
- Independent desktop applications.
- Browser-specific extension packages.
- Complex project or task management functionality.

Keep the product focused on highlighting, annotating, and revisiting web content.

---

## 15. Development Instructions

Before writing substantial code:

1. Inspect the available development environment.
2. Verify current userscript-manager compatibility across the target browsers.
3. Identify API limitations and any implementation compromises.
4. Propose a concise architecture and data schema.
5. Identify technical risks related to text anchoring, overlapping annotations, and dynamic webpages.

Then proceed with implementation.

Write maintainable, modular code with clear separation of responsibilities.

Use meaningful names and comments where they improve maintainability.

Do not overengineer the architecture.

Do not introduce external dependencies unless they provide a clear benefit and can be bundled or used without requiring a backend or remote service.

Prioritize functional correctness and reliable data persistence over decorative details.

Test at minimum:

- Creating, editing, and deleting Highlights.
- All four annotation styles and five colors.
- Overlapping Highlight scenarios.
- Creating and moving both types of Sticky Notes.
- Restoring annotations after page reload.
- Clean View and independent visibility controls.
- Article grouping and URL normalization.
- Search, tags, and favorites.
- JSON export and restoration.
- Merge conflict handling.
- SPA navigation.
- Cross-browser behavior where testing environments are available.

If a feature cannot be implemented reliably in a target environment, clearly explain why and provide the best practical alternative.

Do not silently remove requested features or replace the intended product with a different architecture.

---

## 16. Expected Deliverables

Provide:

1. A working, installable `.user.js` file.
2. Clear installation instructions for Safari, Chrome, Firefox, and Edge, including the relevant userscript-manager requirements.
3. A concise explanation of the architecture and storage model.
4. A list of tested browsers and userscript managers, with compatibility limitations.
5. A short user guide covering highlighting, notes, Library, Clean View, and data backup/restoration.
6. A list of known limitations and future improvements.

The final product should feel like a small, carefully crafted reading companion: unobtrusive while reading, delightful while annotating, and dependable as a personal archive.
