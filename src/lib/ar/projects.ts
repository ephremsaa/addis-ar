import { openDB } from 'idb';
import { z } from 'zod';
export const kinds = ['cube','sphere','cylinder','cone','plane','torus','capsule','model'] as const;
const vector = z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
export const objectSchema = z.object({id:z.string(),name:z.string().max(120),kind:z.enum(kinds),position:vector,rotation:vector,scale:vector,color:z.string().regex(/^#[0-9a-fA-F]{6}$/),roughness:z.number().min(0).max(1),metalness:z.number().min(0).max(1),visible:z.boolean(),locked:z.boolean(),model:z.string().optional()});
export const trackingModes = ['focus-target', 'marker', 'webxr-plane', 'device-orientation'] as const;
export type TrackingMode = typeof trackingModes[number];
export const arConfigSchema = z.object({
  trackingMode: z.enum(trackingModes).default('focus-target'),
  confidenceThreshold: z.number().min(0).max(1).default(0.4),
  smoothingFactor: z.number().min(0).max(1).default(0.4),
  targetSnapshot: z.string().optional(),
  targetLabel: z.string().optional(),
  lockedTarget: z.boolean().default(false),
}).optional();
export type ARConfig = z.infer<typeof arConfigSchema>;
export const projectSchema = z.object({version:z.literal(1),id:z.string(),name:z.string().min(1).max(120),updated:z.number(),created:z.number(),objects:z.array(objectSchema),arConfig:arConfigSchema});
export type SceneObject=z.infer<typeof objectSchema>;
export type Project=z.infer<typeof projectSchema>;
export const palette=['#9682ed','#58ced7','#eaaf71','#f0f0f4','#ec7998','#84cba1'] as const;
export function newObject(kind:SceneObject['kind'],color:string=palette[0]):SceneObject{return {id:crypto.randomUUID(),name:kind.charAt(0).toUpperCase()+kind.slice(1),kind,position:[0,1,0],rotation:[0,0,0],scale:[1,1,1],color,roughness:.3,metalness:.2,visible:true,locked:false};}
export function newProject(name='Untitled experience',template?:string):Project {const now=Date.now(); const p:Project={version:1,id:crypto.randomUUID(),name,created:now,updated:now,objects:[]}; if(template){const a=newObject(template==='Sculpture studio'?'torus':template==='Geometric playground'?'cube':'sphere');a.position=[0,1.5,0];a.scale=[1.5,1.5,1.5];a.rotation=[.4,.4,0];p.objects.push(a);if(template==='Geometric playground'){const b=newObject('sphere',palette[1]);b.position=[1.7,.6,0];p.objects.push(b);}} return p;}
const db=()=>openDB('addis-ar',1,{upgrade(d){d.createObjectStore('projects',{keyPath:'id'});}});
export async function listProjects():Promise<Project[]>{return (await db()).getAll('projects');}
export async function getProject(id:string):Promise<Project|undefined>{return (await db()).get('projects',id);}
export async function saveProject(p:Project){await (await db()).put('projects',projectSchema.parse(p));}
export async function deleteProject(id:string){await (await db()).delete('projects',id);}
export function download(data:Blob,name:string){
  const url=URL.createObjectURL(data);
  const a=document.createElement('a');
  a.href=url;
  a.download=name;
  a.style.display='none';
  document.body.appendChild(a);
  try{
    a.click();
  }catch(err){
    if(typeof navigator!=='undefined' && typeof navigator.canShare==='function'){
      try{
        const file=new File([data],name,{type:data.type||'application/octet-stream'});
        if(navigator.canShare({files:[file]})){
          void navigator.share({files:[file],title:name}).catch(()=>{});
        }
      }catch{
        // ignore share error
      }
    }
  }finally{
    if(a.parentNode){
      a.parentNode.removeChild(a);
    }
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
}
export function blobToDataUrl(blob:Blob):Promise<string>{
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onloadend=()=>{
      if(typeof reader.result==='string'){
        resolve(reader.result);
      }else{
        reject(new Error('Failed to convert Blob to data URL'));
      }
    };
    reader.onerror=()=>reject(reader.error||new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}
export function exportProject(p:Project){download(new Blob([JSON.stringify(p)],{type:'application/json'}),p.name+'.addisar');}
export async function importProject(file:File){const p=projectSchema.parse(JSON.parse(await file.text()));return {...p,id:crypto.randomUUID(),updated:Date.now()};}
