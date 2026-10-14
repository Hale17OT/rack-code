# Session file attachments

Click the clipboard icon at the left of the composer toolbar. Its menu opens upward and offers Images, Documents, Code and text, and Any file. Each choice opens a native multi-file picker with the corresponding filter; Any file accepts every extension. Escape or clicking outside dismisses the menu. Arrow keys and Home/End move through its actions, and Enter selects one.

Selected files appear above the prompt as filename/size chips. Remove a chip with its X button before sending. A message can contain files with or without prompt text, up to 20 files and 50 MB per file. Cancelled selection adds nothing; a failed import rolls back its batch and reports the error. A failed start keeps the draft available for another attempt. Importing blocks sending until it finishes, while Stop remains available for an active run.

Pending attachment selections belong to the session that opened the picker, including when the user changes sessions while it is open. Each session's attachment draft remains available while the renderer stays open. Unsent selections are not restored after a renderer reload. Sent files appear as clickable chips on their turn and survive application restarts; clicking opens or reveals the stored copy using the existing safe path-opening behavior.

## Storage and runtime behavior

Sessions imports files through its application-owned `AttachmentStore` port. The local `DirectoryAttachmentStore` copies regular files into `<dataDirectory>/attachments/<hashed-session-id>/<attachment-id>/file/<filename>` and writes a separate manifest. Files are copied byte for byte and kept outside the project, so attaching them does not modify the Git working tree. Changes to or removal of the original do not change the saved copy. Imported copies are retained, including files subsequently removed from an unsent draft; automatic cleanup and retention controls are future work.

The renderer receives descriptors (`id`, `name`, `path`, `size`) from `sessions.attachFiles` and sends only `attachmentIds` on `runs.start`. Execution resolves those IDs through Sessions before recording a run or acquiring project ownership; a missing file, duplicate ID, or file from another session is rejected. The resolved descriptors persist on `RunRecord.attachments`, with no changes needed to older records.

Execution appends quoted filename/path references to the runtime prompt and the saved user message. Both Codex and Claude use their existing file-reading tools under the selected permission mode. The app accepts any format; interpretation of images, PDFs, office documents, archives, and other binary formats depends on the runtime's tools and available local readers. The app does not convert documents or send native multimodal content blocks. Runtime adapters retain ownership of provider behavior.

Electron main owns the native picker through the narrow `selectFiles(kind)` preload operation, validates its category, and accepts calls only from the bundled renderer. The execution host owns copying through the Sessions service. Separate per-file manifests avoid rewriting conversation state during an active run.
