import { MarkdownPostProcessorContext, Plugin } from "obsidian";
import { getAPI } from "obsidian-dataview";

const majorPattern = /:(pdf-[^:]+):([^:]+):(?:([0-9]*):(?:([0-9]+):)?)?/g;
const minorPattern = /\[([^]]*[^[]*)\]\(([^)]*[^(]*)\)/g;

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
		[...text.matchAll(majorPattern)].forEach(async majorMatch => {
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
				const minorMatch = [...url.matchAll(minorPattern)][0];
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
			}
			else {
				pdfMap.set(url, { file: pdfjs.getDocument(buffer).promise, occurrences: 0 });
				pdf = await pdfMap.get(url)?.file;
			}

			switch (majorMatch[1]) {
				case "pdf-thumbnail":
					let pageNumber: number = parseInt(majorMatch[3]) || 1;
					if (pageNumber > pdf.numPages)
						pageNumber = 1;

					const page = await pdf.getPage(pageNumber);

					context.addChild(new pdfThumbnail(element as HTMLElement, majorMatch[0], url, page, parseInt(majorMatch[4])));
					break;
				case "pdf-page-count":
					context.addChild(new pdfPageCount(element as HTMLElement, majorMatch[0], url, pdf.numPages));
					break;
				default:
					break;
			}
		});
	};
}

import { MarkdownRenderChild } from "obsidian";

export class pdfThumbnail extends MarkdownRenderChild {
	page: any;
	renderTask: any;
	fixedWidth: number | undefined;
	timeoutId: number | undefined;
	pdfOriginalString: string;
	pdfUrl: string;

	constructor(containerEl: HTMLElement, pdfOriginalString: string, pdfUrl: string, page: any, size?: number) {
		super(containerEl);
		this.page = page;
		this.fixedWidth = size;
		this.pdfOriginalString = pdfOriginalString;
		this.pdfUrl = pdfUrl;
	}

	async onload() {
		const pdf = pdfMap.get(this.pdfUrl);
		if (pdf)
			pdfMap.set(this.pdfUrl, { file: pdf.file, occurrences: ++pdf.occurrences });

		const div = document.createElement("div");

		let mainCanvas = document.createElement("canvas");
		div.appendChild(mainCanvas);
		//div.style.float = "right"; // if fixedWidth is defined

		for (const [childIndex, child] of Array.from(this.containerEl.childNodes).entries()) {
			if (child instanceof Text) {
				let text: string;
				text = child.textContent || "";
				if (!text.contains(this.pdfOriginalString)) {
					if (!(this.containerEl.childNodes[childIndex + 1] instanceof HTMLAnchorElement) || !(this.containerEl.childNodes[childIndex + 2] instanceof Text))
						continue;
					text = this.containerEl.childNodes[childIndex]?.textContent || "";
					text = text.concat(this.containerEl.childNodes[childIndex + 1]?.textContent || "");
					text = text.concat(this.containerEl.childNodes[childIndex + 2]?.textContent || "");
					if (!text.contains(this.pdfOriginalString))
						continue;
					const second = this.containerEl.childNodes[childIndex + 1];
					const third = this.containerEl.childNodes[childIndex + 2];
					second.remove();
					third.remove();
				}

				let strings = text.split(this.pdfOriginalString);
				let startTextNode = document.createTextNode(strings[0]);
				child.replaceWith(startTextNode);
				startTextNode.after(div);
				let currentNode: HTMLDivElement | Text;
				currentNode = div;
				strings.forEach((string, index) => {
					if (index > 0) {
						let nextNode = document.createTextNode(string);
						currentNode.after(nextNode);
						currentNode = nextNode;
					}
				});
				break;
			}
		}

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
		this.page.cleanup();
		const pdf = pdfMap.get(this.pdfUrl);
		if (pdf)
			pdfMap.set(this.pdfUrl, { file: pdf.file, occurrences: --pdf.occurrences });
		if (pdf?.occurrences == 0) {
			pdf.file.then(function (pdf: any) {
				pdf.destroy();
			});
			pdfMap.delete(this.pdfUrl);
		}
	}
}

export class pdfPageCount extends MarkdownRenderChild {
	pageNum: number;

	constructor(containerEl: HTMLElement, pdfOriginalString: string, pdfUrl: string, pageNum: number) {
		super(containerEl);
		this.pageNum = pageNum;
	}

	async onload() {
		this.containerEl.innerText = this.containerEl.innerText.replace(majorPattern, this.pageNum.toString());
	}
}