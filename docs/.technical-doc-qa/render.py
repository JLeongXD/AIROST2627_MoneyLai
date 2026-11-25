from pathlib import Path
import importlib.util
from pypdf import PdfReader
q=Path(__file__).parent
skill=Path('C:/Users/Leong/.codex/plugins/cache/openai-primary-runtime/documents/26.1119.11507/skills/documents')
spec=importlib.util.spec_from_file_location('renderer',skill/'render_docx.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.convert_to_pdf=lambda *a,**kw:(str(q/'final.pdf'),{})
m.rasterize(str(q.parent/'MoneyLai_Technical_Documentation.docx'),str(q/'render'),110,False,False)
pdf=PdfReader(q/'final.pdf')
for i,page in enumerate(pdf.pages):
 print(i+1,len(page.extract_text()),page.extract_text()[:90].replace('\n',' | '))
