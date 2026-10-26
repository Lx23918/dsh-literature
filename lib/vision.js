// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Lx23918 and contributors
export async function viewPage(ctx,store,sid,args,exec){
 const routed=exec.agent?.session.requestHeader()?.config,provider=routed?.provider??exec.agent?.options.provider,model=routed?.model??exec.agent?.options.model,llm=ctx.get('llm'),attachments=ctx.get('attachments');
 if(!llm||provider===undefined||model===undefined)throw new Error('无法确认当前模型的图像能力');
 const info=await llm.resolveModelInfo(provider,model,exec.signal);
 if(!info.inputModalities?.includes('image'))throw new Error('当前模型未声明图像输入能力，请选择支持图像的模型');
 if(!attachments?.imageLimits.mediaTypes.includes('image/png'))throw new Error('宿主未提供 PNG 图像附件支持');
 const rendered=await store.renderPage(sid,args);exec.signal?.throwIfAborted();
 const image=await attachments.saveImage({data:Buffer.from(rendered.image,'base64'),mediaType:'image/png',name:`paper-page-${rendered.page}.png`});
 return {paperId:rendered.paperId,title:rendered.title,page:rendered.page,clip:args.clip??null,image:{attachmentId:image.attachmentId,mediaType:image.mediaType,bytes:image.bytes,width:image.width,height:image.height,name:image.name}};
}
export function pageContent(_args,value){return [{type:'text',text:JSON.stringify({paperId:value.paperId,title:value.title,page:value.page,clip:value.clip,notice:'真实PDF页图；图像解读不等于摘句核验。'})},{type:'image',attachment:value.image}];}
