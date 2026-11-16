#!/usr/bin/env python3
"""Safe one-way sync: client JSON/PDFs -> public listing JSON."""
import json, os, re, subprocess, sys
from pathlib import Path
import fitz

CLIENT=Path("espace-client/biens")
VISIT=Path("espace-visite/biens")
TEMPLATE=Path("espace-visite/archives/template_data.json")
META=".sync_metadata.json"
NUM=r"(\d{1,4}(?:[,.]\d{1,2})?)"
PDF_RULES={
 "surface": re.compile(r"(?:surface habitable|surface loi carrez|surface carrez)\s*[:\-]?\s*"+NUM+r"\s*m(?:²|2)",re.I),
 "exterieur": re.compile(r"(?:surface terrasse|surface balcon|surface extérieure|surface exterieure)\s*[:\-]?\s*"+NUM+r"\s*m(?:²|2)",re.I),
 "annee": re.compile(r"(?:année|annee|date) de construction\s*[:\-]?\s*((?:19|20)\d{2})",re.I),
 "dpe.energie": re.compile(r"(?:classe énergétique|classe energetique|étiquette énergie|etiquette energie)[^\n]{0,50}\b([A-G])\b",re.I),
 "dpe.ges": re.compile(r"(?:classe climat|étiquette climat|etiquette climat)[^\n]{0,50}\b([A-G])\b",re.I),
}
def changed_sources():
 before=os.getenv("GITHUB_EVENT_BEFORE",""); current=os.getenv("GITHUB_SHA","HEAD")
 if not before or set(before)=={"0"}: return []
 names=subprocess.check_output(["git","diff","--diff-filter=AM","--name-only",before,current,"--",str(CLIENT)],text=True).splitlines()
 return [Path(n) for n in names if n.endswith(".json") and Path(n).is_file()]
def get(obj,path):
 for k in path:
  if not isinstance(obj,dict) or k not in obj: return None
  obj=obj[k]
 return obj
def put(obj,path,value):
 for k in path[:-1]: obj=obj.setdefault(k,{})
 obj[path[-1]]=value
def blank_template(template,slug):
 d=json.loads(json.dumps(template)); d["slug"]=slug; d["statut"]="disponible"
 for k in ("nom","bien_type","type","etage","charges","taxe_fonciere","ville","secteur","stationnement","chauffage","proximite"): d[k]=""
 for k in ("surface","exterieur","annee","prix"): d[k]=None
 d["dpe"]={"energie":"","ges":""}; d["points_forts"]=[]; d["photos_count"]=0; d["video"]=""; d["annonce"]=""
 return d
def pdf_values(folder):
 text=[]
 docs=folder/"documents"
 if docs.is_dir():
  for f in sorted(docs.glob("*.pdf")):
   try:
    with fitz.open(f) as pdf: text.extend(p.get_text("text") for p in pdf)
   except Exception as e: print(f"PDF lu sans modification, extraction impossible {f}: {e}",file=sys.stderr)
 alltext="\n".join(text); result={}
 for field,pattern in PDF_RULES.items():
  m=pattern.search(alltext)
  if m:
   value=m.group(1).replace(",",".")
   if field in ("surface","exterieur","annee"):
    n=float(value); value=int(n) if n.is_integer() else n
   else: value=value.upper()
   result[field]=value
 return result
def sync(path,template):
 slug=path.stem[:-5] if path.stem.endswith("_data") else path.stem
 client=json.loads(path.read_text(encoding="utf-8")); folder=VISIT/slug
 folder.mkdir(parents=True,exist_ok=True); (folder/"photos").mkdir(exist_ok=True); (folder/"documents").mkdir(exist_ok=True)
 public_path=folder/f"{slug}_data.json"; meta_path=folder/META; existed=public_path.exists()
 public=json.loads(public_path.read_text(encoding="utf-8")) if existed else blank_template(template,slug)
 if meta_path.exists(): meta=json.loads(meta_path.read_text(encoding="utf-8"))
 else:
  meta={"version":1,"auto_values":{},"manual_fields":[]}
  if existed:
   for key,value in public.items():
    if value not in (None,"",[],{}): meta["manual_fields"].append(key)
   for sub in ("energie","ges"):
    if public.get("dpe",{}).get(sub) not in (None,""): meta["manual_fields"].append("dpe."+sub)
 candidates={}
 name=get(client,("bien","nom"))
 if name not in (None,""): candidates["nom"]=name
 status=client.get("statut_bien")
 if status=="sous_compromis": candidates["statut"]="sous_compromis"
 elif status=="en_ligne": candidates["statut"]="disponible"
 address=get(client,("bien","adresse_complete"))
 if isinstance(address,str):
  m=re.search(r"\b\d{5}\s+(.+?)\s*$",address)
  if m: candidates["ville"]=m.group(1).strip()
 for k,v in pdf_values(folder).items():
  candidates.setdefault(k,v)
 auto=meta.setdefault("auto_values",{}); manual=set(meta.setdefault("manual_fields",[]))
 for field,value in candidates.items():
  parts=field.split("."); current=get(public,parts)
  if field in manual: continue
  if field in auto and current!=auto[field]: manual.add(field); continue
  if field not in auto and current not in (None,"",[],{}) and (existed or field != "statut"): manual.add(field); continue
  put(public,parts,value); auto[field]=value
 photo_count=sum(1 for f in (folder/"photos").iterdir() if f.is_file() and f.suffix.lower() in {".jpg",".jpeg",".png",".webp",".avif"})
 if "photos_count" in manual:
  pass
 elif "photos_count" in auto and public.get("photos_count") != auto["photos_count"]:
  manual.add("photos_count")
 else:
  public["photos_count"]=photo_count
  auto["photos_count"]=photo_count
 meta["manual_fields"]=sorted(manual)
 for dest,data in ((public_path,public),(meta_path,meta)):
  tmp=dest.with_suffix(dest.suffix+".tmp"); tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"); tmp.replace(dest)
 print(f"Synchronisé: {slug} ({'créé' if not existed else 'mis à jour'})")
def main():
 template=json.loads(TEMPLATE.read_text(encoding="utf-8"))
 files=changed_sources()
 if not files: print("Aucun JSON client nouveau ou modifié."); return
 for f in files: sync(f,template)
if __name__=="__main__": main()
