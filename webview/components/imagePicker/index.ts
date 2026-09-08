import "./imagePicker.css";
import { t } from "@/i18n";
import { attachImgPathComplete } from "../imageView/imgPathComplete";

type OnPick = (file: File) => void;
type OnSelectProject = (relPath: string) => void;
type OnUrl = (url: string) => void;

export function showImagePicker(
    onPick: OnPick,
    onSelectProject: OnSelectProject,
    onUrl: OnUrl,
    getProjectImages: () => Promise<Array<{ relPath: string; webviewUri: string; name: string }> | null>,
): void {
    let activeTab: "upload" | "project" | "url" = "upload";

    const overlay = document.createElement("div");
    overlay.className = "epytor-img-picker-overlay";

    const dialog = document.createElement("div");
    dialog.className = "epytor-img-picker";

    // Tabs
    const tabs = document.createElement("div");
    tabs.className = "epytor-img-picker-tabs";
    const makeTab = (label: string, key: typeof activeTab) => {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.className = `epytor-img-picker-tab${key === activeTab ? " active" : ""}`;
        btn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            activeTab = key;
            tabs.querySelectorAll(".epytor-img-picker-tab").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            panelUpload.style.display = key === "upload" ? "" : "none";
            panelProject.style.display = key === "project" ? "" : "none";
            panelUrl.style.display = key === "url" ? "" : "none";
            if (key === "project") loadProjectImages();
        });
        return btn;
    };
    const tabUpload = makeTab(t("Upload"), "upload");
    const tabProject = makeTab(t("Project Images"), "project");
    const tabUrl = makeTab(t("URL"), "url");
    tabs.appendChild(tabUpload);
    tabs.appendChild(tabProject);
    tabs.appendChild(tabUrl);

    // Upload panel
    const panelUpload = document.createElement("div");
    panelUpload.className = "epytor-img-picker-panel";
    const dropZone = document.createElement("div");
    dropZone.className = "epytor-img-picker-dropzone";
    dropZone.textContent = t("Click or drag image here");
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.accept = "image/*";
    fileInput.style.display = "none";
    dropZone.appendChild(fileInput);
    panelUpload.appendChild(dropZone);

    // URL panel
    const panelUrl = document.createElement("div");
    panelUrl.className = "epytor-img-picker-panel";
    panelUrl.style.display = "none";
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "epytor-img-picker-url-input";
    urlInput.placeholder = t("Image URL https://...");
    const urlInsertBtn = document.createElement("button");
    urlInsertBtn.className = "epytor-img-picker-url-btn";
    urlInsertBtn.textContent = t("Insert");
    urlInsertBtn.addEventListener("click", () => {
        const v = urlInput.value.trim();
        if (v) { onUrl(v); close(); }
    });
    urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") urlInsertBtn.click(); });
    panelUrl.appendChild(urlInput);
    panelUrl.appendChild(urlInsertBtn);
    // 路径自动补全：保存 detach，关闭对话框时必须移除 document 级监听——
    // 回归：detach 被丢弃时每开一次选择器泄漏一个 document mousedown 监听，
    // 且关闭后防抖回调可让下拉游离复活到页面左上角
    const detachComplete = attachImgPathComplete(urlInput);

    // Project images panel
    const panelProject = document.createElement("div");
    panelProject.className = "epytor-img-picker-panel";
    panelProject.style.display = "none";
    const grid = document.createElement("div");
    grid.className = "epytor-img-picker-grid";
    const gridStatus = document.createElement("div");
    gridStatus.className = "epytor-img-picker-status";
    gridStatus.textContent = t("Loading...");
    panelProject.appendChild(gridStatus);
    panelProject.appendChild(grid);

    dialog.appendChild(tabs);
    dialog.appendChild(panelUpload);
    dialog.appendChild(panelUrl);
    dialog.appendChild(panelProject);
    overlay.appendChild(dialog);

    // Close（先 detach 补全监听再移除 overlay）
    const close = () => {
        detachComplete();
        overlay.remove();
    };
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });

    // Upload events
    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
        const f = e.dataTransfer?.files?.[0];
        if (f?.type.startsWith("image/")) { onPick(f); close(); }
    });
    fileInput.addEventListener("change", () => {
        const f = fileInput.files?.[0];
        if (f) { onPick(f); close(); }
    });

    // Project images
    let imagesLoaded = false;
    function loadProjectImages(): void {
        if (imagesLoaded) return;
        imagesLoaded = true;
        gridStatus.style.display = "";
        getProjectImages()
            .then((images) => {
                gridStatus.style.display = "none";
                renderGrid(images ?? []);
            })
            .catch(() => {
                gridStatus.textContent = t("Failed to load images");
            });
    }

    function renderGrid(images: Array<{ relPath: string; webviewUri: string; name: string }>): void {
        grid.innerHTML = "";
        if (images.length === 0) {
            gridStatus.textContent = t("No images found");
            return;
        }
        for (const img of images) {
            const item = document.createElement("div");
            item.className = "epytor-img-picker-item";
            const thumb = document.createElement("img");
            thumb.src = img.webviewUri;
            thumb.loading = "lazy";
            const nameEl = document.createElement("span");
            nameEl.className = "epytor-img-picker-item-name";
            nameEl.textContent = img.name;
            item.appendChild(thumb);
            item.appendChild(nameEl);
            item.addEventListener("click", () => { onSelectProject(img.webviewUri); close(); });
            grid.appendChild(item);
        }
    }

    document.body.appendChild(overlay);
}
