import { Plugin } from "obsidian";
import { getAPI } from "obsidian-dataview";

const majorPattern = new RegExp(/:pdf-[^:]*:[^:]*:(?:[0-9]*:)?$/);
const minorPattern = new RegExp(/\((?:[^)]*)[^(]*\)/);


export default class PdfHelper extends Plugin {
	async onload() {
		const dataviewPromise = new Promise(resolve => {
			this.app.metadataCache.on("dataview:index-ready", () => {
				resolve("Ok");
			});
		});

		this.registerMarkdownPostProcessor(async (element, context) => {
			const pElements = element.querySelectorAll("p, td, th");

			for (let index = 0; index < pElements.length; index++) {


				const pElement = pElements.item(index);
				const text = pElement.innerHTML.trim();

				let match = majorPattern.exec(text);

				if (match?.length != 1)
					continue;

				const params = match[0].split(":");

				let url = params[2];
				if (context.frontmatter != undefined)
					url = context.frontmatter[url] ?? url;

				if (url.startsWith("[["))
					url = url?.substring(2, url.length - 2);
				else {
					if (!url.startsWith("[")) {
						await dataviewPromise;
						url = getAPI(this.app).page(context.sourcePath)[url];
					}

					match = minorPattern.exec(url);
					if (match?.length != 1)
						continue;
					url = match[0];
					url = url?.substring(1, url.length - 1);
				}
				url = url.replaceAll("%20", " ");

				if (!url.match(/.pdf$/))
					continue;
				url = this.app.metadataCache.getFirstLinkpathDest(url, "")?.path || "";

				if (!url)
					continue;

				const obsidian = require("obsidian");
				const pdfjs = await (0, obsidian.loadPdfJs)();

				const arrayBuffer = await this.app.vault.adapter.readBinary(url);
				const buffer = new Uint8Array(arrayBuffer);
				const pdf = await pdfjs.getDocument(buffer).promise;

				switch (params[1]) {
					case "pdf-thumbnail":
						let pageNumber: number = parseInt(params[3]) || 1;
						if (pageNumber > pdf.numPages)
							pageNumber = 1;

						const page = await pdf.getPage(pageNumber);

						context.addChild(new pdfThumbnail(pElement, page));
						break;
					case "pdf-page-count":
						context.addChild(new pdfPageCount(pElement, pdf.numPages));
						break;
					default:
						break;
				}

			}
		});
	}
}

import { MarkdownRenderChild } from "obsidian";

export class pdfThumbnail extends MarkdownRenderChild {
	page: any;

	constructor(containerEl: HTMLElement, page: any) {
		super(containerEl);
		this.page = page;
	}

	async onload() {
		const canvas = document.createElement("canvas");
		canvas.style.width = "100%";
		canvas.style.margin = "0em";

		const context = canvas.getContext("2d");

		const baseViewportWidth = this.page.getViewport({ scale: 1 }).width;
		const baseScale = canvas.clientWidth ? canvas.clientWidth / baseViewportWidth : 1;
		const viewport = this.page.getViewport({ scale: baseScale });

		canvas.height = viewport.height;
		canvas.width = viewport.width;

		const renderContext = { canvasContext: context, viewport };
		this.page.render(renderContext);

		this.containerEl.replaceWith(canvas);
	}
}

export class pdfPageCount extends MarkdownRenderChild {
	pageNum: number;

	constructor(containerEl: HTMLElement, pageNum: number) {
		super(containerEl);
		this.pageNum = pageNum;
	}

	async onload() {
		this.containerEl.innerText = this.containerEl.innerText.replace(majorPattern, this.pageNum.toString());
	}
}