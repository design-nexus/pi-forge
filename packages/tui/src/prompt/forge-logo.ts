import { APP_DISPLAY_NAME } from "@oh-my-pi/pi-utils/dirs";
import { Image } from "../components/image";
import { registerNativeBlob } from "../native/blobs";
import { node } from "../native/describe";
import type { NativeNode } from "../native/node";
import { theme } from "../theme/theme";
import imageData from "./forge-logo.base64.txt" with { type: "text" };

const data = imageData.trim();
const bytes = Buffer.from(data, "base64");

/** Approved compact mark: unchanged pi geometry, smaller gradient lettering. */
export function forgeLogoNode(width = 128): NativeNode {
	return node(
		"image",
		{
			blob: registerNativeBlob(bytes, "image/png"),
			alt: APP_DISPLAY_NAME,
			w: 288,
			h: 240,
			max: { w: width },
			role: "omp.welcome.logo",
		},
		undefined,
		"logo",
	);
}

export function createForgeLogoImage(): Image {
	return new Image(
		data,
		"image/png",
		{ fallbackColor: text => theme.fg("dim", text) },
		{
			maxWidthCells: 12,
			filename: APP_DISPLAY_NAME,
		},
	);
}
