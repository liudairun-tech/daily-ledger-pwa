/** Improves dark payment screenshots before running OCR without uploading them. */
async function enhanceImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const maxDimension = 2800
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) { bitmap.close(); return file }
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const image = context.getImageData(0, 0, width, height)
  let luminanceTotal = 0
  const sampleStep = Math.max(4, Math.floor(image.data.length / 40_000 / 4) * 4)
  for (let index = 0; index < image.data.length; index += sampleStep) {
    luminanceTotal += image.data[index]! * 0.299 + image.data[index + 1]! * 0.587 + image.data[index + 2]! * 0.114
  }
  const average = luminanceTotal / Math.ceil(image.data.length / sampleStep)
  const invert = average < 115
  for (let index = 0; index < image.data.length; index += 4) {
    const luminance = image.data[index]! * 0.299 + image.data[index + 1]! * 0.587 + image.data[index + 2]! * 0.114
    const gray = invert ? 255 - luminance : luminance
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128))
    image.data[index] = contrasted
    image.data[index + 1] = contrasted
    image.data[index + 2] = contrasted
  }
  context.putImageData(image, 0, 0)
  return await new Promise(resolve => canvas.toBlob(blob => resolve(blob ?? file), 'image/png'))
}

export async function prepareImageForOcr(file: File): Promise<Blob> {
  try { return await enhanceImage(file) } catch { return file }
}
