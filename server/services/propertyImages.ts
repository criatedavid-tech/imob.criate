import { supabase } from "../supabase";

// Extraído de server/routes/properties.ts (rota POST /upload-image) para ser
// reaproveitável pelo pipeline de fotos do WhatsApp Pai (Fase 5) — mesmo
// corpo, comportamento inalterado, a rota HTTP virou um wrapper fino em cima.
export async function uploadPropertyImageBase64(userId: string, imageData: string): Promise<string> {
  const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error("Imagem muito grande (máx. 8MB).");
  }

  const fileName = `prop-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

  await supabase.storage.createBucket('property-images', {
    public: true,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    fileSizeLimit: 8388608,
  }).catch(() => {}); // ignora erro se bucket já existe

  const { error: uploadError } = await supabase.storage
    .from('property-images')
    .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });
  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage
    .from('property-images')
    .getPublicUrl(fileName);
  return publicUrl;
}
