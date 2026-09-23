# FileSourcePicker

Shared floating file-source menu. Placement is controlled by its host. Motion,
tooltips, focus, hover, touch/click, Escape, outside-click, busy state and cleanup
belong to the shared component/controller. Reduced-motion preferences disable
transitions. Cloud sources are explicitly unavailable, with no network actions.

Render in any tool:

```razor
<FileSourcePicker Label="เพิ่มไฟล์" ShowCloudOptions="true" />
```

Initialize once from that tool's TypeScript controller:

```ts
import { createFileSourcePicker } from "../shared/file-source-picker";
const picker = createFileSourcePicker(
  toolRoot.querySelector<HTMLElement>("[data-file-picker]")!,
  () => fileInput.click(),
);
picker.update(numberOfFiles, isBusy);
// On tool disposal:
picker.dispose();
```

Keep the selection callback synchronous to preserve browser file-picker user
activation. Each Razor instance generates a unique menu ID. Query within the
specific tool root when multiple instances exist. Set `ShowCloudOptions="false"`
for local-only tools. CSS is in `wwwroot/css/file-source-picker.css`, loaded by
`index.html`; customize `--picker-color` on the host if needed.

The expansion is approximately 220 ms with short source-item delays. Hidden
sources become inert immediately, so collapsing controls cannot receive focus
or clicks while their exit animation finishes.
