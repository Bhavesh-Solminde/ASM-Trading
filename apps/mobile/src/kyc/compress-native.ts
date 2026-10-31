import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { compressWith, fitResize, knownSize, type Compressed } from "./compress";

/**
 * Re-encodes a captured or picked photo as a JPEG that fits the upload budget, trying `ATTEMPTS` in order. Returns
 * null when none fits (the screen asks for a retake) and throws when the size of an encode cannot be read.
 * `width` and `height` are the photo's pixel size as the camera or picker reported it. The logic lives in
 * `compress.ts`; this only drives the native modules.
 */
export function compressForUpload(uri: string, width: number, height: number): Promise<Compressed | null> {
  return compressWith(async (maxSide, quality) => {
    const image = await ImageManipulator.manipulate(uri).resize(fitResize(width, height, maxSide)).renderAsync();
    const saved = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG });
    // An unknown size throws (see `knownSize`): the screen shows a generic error, not "Photo too large".
    return { uri: saved.uri, bytes: knownSize(new File(saved.uri).size) };
  });
}
