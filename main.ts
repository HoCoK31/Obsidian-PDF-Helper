import { MarkdownPostProcessorContext, Plugin } from "obsidian";
import { getAPI } from "obsidian-dataview";

const majorPattern = new RegExp(/:(pdf-[^:]+):([^:]+):(?:([0-9]*):(?:([0-9]+):)?)?/);
const minorPattern = new RegExp(/\[([^]]*[^[]*)\]\(([^)]*[^(]*)\)/);

const pdfMap = new Map<string, { file: any, occurrences: number }>;

export default class PdfHelper extends Plugin {
	async onload() {
		const dataviewPromise = new Promise(resolve => {
			// @ts-ignore
			this.app.metadataCache.on("dataview:index-ready", () => {
				resolve("Ok");
			});
		});

		this.registerMarkdownPostProcessor((element, context) => {
			Array.from(element.querySelectorAll("p, td, th, span")).forEach(async element => {
				this.processElement(element, context);
			});
			//hack for dataview (idk, some versions before it works without it)
			if (element.tagName == "SPAN")
				this.processElement(element, context);
		});
	}

	async processElement(element: Element, context: MarkdownPostProcessorContext) {
		const text = element.textContent;
		if (!text)
			return;
		const majorMatch = majorPattern.exec(text);

		if (!majorMatch?.length)
			return;

		let url = majorMatch[2];

		Array.from(element.getElementsByTagName("a")).forEach(a => {
			if (a.textContent == majorMatch[2])
				url = a.getAttribute("data-link-path") || url;
		});
		if (!url.match(/.pdf$/)) {
			//await dataviewPromise;
			url = getAPI(this.app).page(context.sourcePath)[url] || url;
			const minorMatch = minorPattern.exec(url);
			if (minorMatch?.length == 3)
				url = minorMatch[2].replaceAll("%20", " ");
		}
		if (!url.match(/.pdf$/))
			url = url.concat(".pdf");
		url = this.app.metadataCache.getFirstLinkpathDest(url, "")?.path || "";
		if (!url)
			return;

		const obsidian = require("obsidian");
		const pdfjs = await (0, obsidian.loadPdfJs)();

		const arrayBuffer = await this.app.vault.adapter.readBinary(url);
		const buffer = new Uint8Array(arrayBuffer);
		let pdf: any;
		if (pdfMap.has(url)) {
			pdf = await pdfMap.get(url)?.file;
			console.log("exist")
		}
		else {
			pdfMap.set(url, { file: pdfjs.getDocument(buffer).promise, occurrences: 0 });
			pdf = await pdfMap.get(url)?.file;
			console.log("add")
		}

		switch (majorMatch[1]) {
			case "pdf-thumbnail":
				let pageNumber: number = parseInt(majorMatch[3]) || 1;
				if (pageNumber > pdf.numPages)
					pageNumber = 1;

				const page = await pdf.getPage(pageNumber);

				context.addChild(new pdfThumbnail(element as HTMLElement, url, page, parseInt(majorMatch[4])));
				break;
			case "pdf-page-count":
				context.addChild(new pdfPageCount(element as HTMLElement, url, pdf.numPages));
				break;
			default:
				break;
		}
	};
}

import { MarkdownRenderChild } from "obsidian";

export class pdfThumbnail extends MarkdownRenderChild {
	page: any;
	renderTask: any;
	fixedWidth: number | undefined;
	timeoutId: number | undefined;
	pdfUrl: string;

	constructor(containerEl: HTMLElement, pdfUrl: string, page: any, size?: number) {
		super(containerEl);
		this.page = page;
		this.fixedWidth = size;
		this.pdfUrl = pdfUrl;
	}

	async onload() {
		console.log("load")
		const pdf = pdfMap.get(this.pdfUrl);
		if (pdf)
			pdfMap.set(this.pdfUrl, { file: pdf.file, occurrences: ++pdf.occurrences });

		const div = document.createElement("div");

		let mainCanvas = document.createElement("canvas");
		div.appendChild(mainCanvas);
		this.containerEl.after(div);
		this.containerEl.hide();

		resizeCanvas.call(this);
		let resizeObserver = new ResizeObserver(_ => { resizeCanvas.call(this) });
		if (!this.fixedWidth)
			resizeObserver.observe(div);

		async function resizeCanvas() {
			if (!div?.clientWidth && !this.fixedWidth) {
				return;
			}

			const canvas = document.createElement("canvas");
			const context = canvas.getContext("2d");
			const baseViewportWidth = this.page.getViewport({ scale: 1 }).width;

			mainCanvas.style.width = "100%";

			const scale = (this.fixedWidth || mainCanvas.clientWidth) / baseViewportWidth;
			const viewport = this.page.getViewport({ scale: scale * window.devicePixelRatio || 1 });

			mainCanvas.style.width = Math.floor(viewport.width) / (window.devicePixelRatio || 1) + "px";
			mainCanvas.style.height = Math.floor(viewport.height) / (window.devicePixelRatio || 1) + "px";

			canvas.width = Math.floor(viewport.width);
			canvas.height = Math.floor(viewport.height);
			canvas.style.width = Math.floor(viewport.width) / (window.devicePixelRatio || 1) + "px";
			canvas.style.height = Math.floor(viewport.height) / (window.devicePixelRatio || 1) + "px";

			clearTimeout(this.timeoutId);

			this.timeoutId = setTimeout(async () => {
				const renderContext = { canvasContext: context, viewport: viewport };

				this.renderTask = this.page.render(renderContext);
				await this.renderTask.promise;

				mainCanvas.replaceWith(canvas);
				mainCanvas = canvas;
			}, this.timeoutId === undefined ? 0 : 100)
		}
	}

	async onunload() {
		console.log("unload")
		this.page.cleanup();
		const pdf = pdfMap.get(this.pdfUrl);
		if (pdf)
			pdfMap.set(this.pdfUrl, { file: pdf.file, occurrences: --pdf.occurrences });
		if (pdf?.occurrences == 0) {
			console.log("destroy ", this.pdfUrl);
			pdf.file.then(function (pdf: any) {
				pdf.destroy();
			});
			pdfMap.delete(this.pdfUrl);
		}
		console.log(pdf?.occurrences);
	}
}

export class pdfPageCount extends MarkdownRenderChild {
	pageNum: number;

	constructor(containerEl: HTMLElement, pdfUrl: string, pageNum: number) {
		super(containerEl);
		this.pageNum = pageNum;
	}

	async onload() {
		this.containerEl.innerText = this.containerEl.innerText.replace(majorPattern, this.pageNum.toString());
	}
}