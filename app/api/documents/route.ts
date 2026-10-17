import { NextRequest, NextResponse } from 'next/server';
import { authenticated, checkOrigin, failure, HttpError } from '@/lib/server';
import { extensions, MAX_UPLOAD } from '@/lib/validation';
export async function POST(request: NextRequest) {
  try {
    checkOrigin(request); const {db,user} = await authenticated();
    if (Number(request.headers.get('content-length')) > MAX_UPLOAD + 1024 * 128) throw new HttpError(413,'Choose a document smaller than 10 MB.');
    const form = await request.formData(); const file = form.get('file'); const text = form.get('text');
    const title = String(form.get('title') ?? 'Product requirements').trim().slice(0,160);
    let bytes: Uint8Array; let name: string; let ext: string;
    if (file instanceof File) { if (!file.size || file.size > MAX_UPLOAD) throw new HttpError(400,'Choose a nonempty document smaller than 10 MB.'); name = file.name; ext = name.split('.').pop()?.toLowerCase() ?? ''; if (!extensions.includes(ext)) throw new HttpError(400,'Supported formats: TXT, Markdown, PDF, and DOCX.'); bytes = new Uint8Array(await file.arrayBuffer()); }
    else { if (typeof text !== 'string' || !text.trim()) throw new HttpError(400,'Paste a PRD or select a document.'); bytes = new TextEncoder().encode(text.trim()); name = 'product-requirements.md'; ext = 'md'; if (bytes.byteLength > MAX_UPLOAD) throw new HttpError(413,'Keep the PRD below 10 MB.'); }
    const id = crypto.randomUUID(); const path = `${user.id}/${id}.${ext}`;
    const {error:uploadError} = await db.storage.from('prds').upload(path, bytes, { contentType: ext === 'pdf' ? 'application/pdf' : ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain', upsert:false });
    if (uploadError) throw new Error('Storage upload failed');
    const {error} = await db.from('documents').insert({id,owner_id:user.id,title,filename:name,storage_path:path,extension:ext,byte_size:bytes.byteLength});
    if (error) { await db.storage.from('prds').remove([path]); throw new Error('Document save failed'); }
    return NextResponse.json({id},{status:201});
  } catch(e) { return failure(e); }
}
