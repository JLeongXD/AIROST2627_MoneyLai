from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs'/'MoneyLai_Technical_Documentation.docx'
d=Document()
s=d.sections[0]; s.page_width=Inches(8.27); s.page_height=Inches(11.69)
s.top_margin=s.bottom_margin=Inches(.72); s.left_margin=s.right_margin=Inches(.78)
for name in ['Normal','Title','Subtitle','Heading 1','Heading 2','Heading 3']:
 st=d.styles[name]; st.font.name='Calibri'; st.font.color.rgb=RGBColor(0,0,0)
 for border in list(st.element.xpath('./w:pPr/w:pBdr')): border.getparent().remove(border)
n=d.styles['Normal']; n.font.size=Pt(11); n.paragraph_format.space_after=Pt(6); n.paragraph_format.line_spacing=1.06
for name,size in [('Title',28),('Heading 1',19),('Heading 2',13)]:
 st=d.styles[name]; st.font.size=Pt(size); st.font.bold=True
 st.paragraph_format.space_before=Pt(11); st.paragraph_format.space_after=Pt(8)
f=s.footer.paragraphs[0]; f.alignment=WD_ALIGN_PARAGRAPH.RIGHT
r=f.add_run('MoneyLai  |  '); r.font.size=Pt(9)
fld=OxmlElement('w:fldSimple'); fld.set(qn('w:instr'),'PAGE'); f._p.append(fld)
def p(t): return d.add_paragraph(t)
counter=0
def h(t):
 global counter
 counter=0
 return d.add_heading(t,2)
def page(t):
 d.add_page_break(); d.add_heading(t,1)
def step(t):
 global counter
 counter+=1
 a=d.add_paragraph(str(counter)+'.  '+t); a.paragraph_format.space_after=Pt(6)
 a.paragraph_format.left_indent=Inches(.2); a.paragraph_format.first_line_indent=Inches(-.2)
def code(t):
 a=d.add_paragraph(); a.paragraph_format.space_after=Pt(8)
 r=a.add_run(t); r.font.name='Consolas'; r.font.size=Pt(9)
def table(headers,rows,widths):
 t=d.add_table(rows=1, cols=len(headers)); t.alignment=WD_TABLE_ALIGNMENT.CENTER; t.autofit=False
 for c,w in zip(t.columns,widths):c.width=Inches(w)
 for i,v in enumerate(headers):t.rows[0].cells[i].text=v
 for vals in rows:
  cells=t.add_row().cells
  for c,v in zip(cells,vals):c.text=v
 for j,row in enumerate(t.rows):
  trpr=row._tr.get_or_add_trPr(); trpr.append(OxmlElement('w:cantSplit'))
  if j==0:trpr.append(OxmlElement('w:tblHeader'))
  for i,c in enumerate(row.cells):
   c.width=Inches(widths[i]); c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
   cp=c._tc.get_or_add_tcPr(); borders=OxmlElement('w:tcBorders')
   for edge in ['top','left','bottom','right']:
    el=OxmlElement('w:'+edge); el.set(qn('w:val'),'single'); el.set(qn('w:sz'),'4'); el.set(qn('w:color'),'D9D9D9'); borders.append(el)
   cp.append(borders); sh=OxmlElement('w:shd'); sh.set(qn('w:fill'),'203B50' if j==0 else ('F1F5F7' if j%2 else 'FFFFFF')); cp.append(sh)
   margins=OxmlElement('w:tcMar')
   for edge in ['top','left','bottom','right']:
    el=OxmlElement('w:'+edge); el.set(qn('w:w'),'90'); el.set(qn('w:type'),'dxa'); margins.append(el)
   cp.append(margins)
   for a in c.paragraphs:
    a.paragraph_format.space_after=Pt(3); a.paragraph_format.line_spacing=1.05
    for r in a.runs:
     r.font.size=Pt(10); r.font.bold=(j==0)
     if j==0:r.font.color.rgb=RGBColor(255,255,255)
 p('')
def link(label,url):
 a=d.add_paragraph(); a.add_run(label+' ')
 el=OxmlElement('w:hyperlink'); el.set(qn('r:id'),a.part.relate_to(url,'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',is_external=True))
 r=OxmlElement('w:r'); pr=OxmlElement('w:rPr'); col=OxmlElement('w:color'); col.set(qn('w:val'),'176078');pr.append(col);r.append(pr);tx=OxmlElement('w:t');tx.text=url;r.append(tx);el.append(r);a._p.append(el)

d.add_heading('MoneyLai Technical Documentation',0)
p('Club Budget and Reimbursement Management Web Application')
p('Prepared by Tho Jian Leong\nTeam Let Me Solo It\nTechnical Track\n25 November 2026')
h('Project overview')
p('MoneyLai centralises student club activity budgets, expense claims, receipts, review decisions and reimbursement records. It gives members a clear submission process, helps Treasurers manage spending, and gives the President visibility over budget decisions. The application uses an English interface and Malaysian Ringgit throughout.')
p('The current implementation includes a complete claim workflow, President budget approval, private document storage, optional Gemini receipt assistance, duplicate receipt warnings and activity accountability exports. Payments are made through an external bank or e-wallet service and then recorded in MoneyLai.')
link('GitHub repository', 'https://github.com/JLeongXD/AIROST2627_MoneyLai')
table(['Role','Main responsibilities'],[
 ('Member','Prepare own claims, maintain payout details, upload receipts and follow reimbursement progress.'),
 ('Treasurer','Propose budgets, review other users’ claims, record external payments and export activity evidence.'),
 ('President','Approve budget proposals, monitor activity summaries and export summary reports.')],[1.15,5.55])
h('Document guide')
p('1  Environment setup and installation\n2  Development process\n3  Usage\n4  Weekly progress')
p('Source baseline: commit 99ae824 dated 25 November 2026. Weekly entries follow the supplied intern logbook, with a separate update for features committed on 25 November.')

page('1 Environment setup and installation')
h('1 1 Prerequisites')
table(['Requirement','Purpose'],[
 ('Node.js 20.9 or newer','Use a supported LTS release compatible with the locked Next.js version.'),
 ('Git and a code editor','Clone the repository and maintain the source code.'),
 ('Supabase project','Provide Auth, PostgreSQL, private Storage and database RPCs.'),
 ('Google Gemini API access','Enable optional AI receipt extraction and claim checks.'),
 ('Vercel account','Optional deployment target for the Next.js application.')],[1.65,5.05])
h('1 2 Clone and install')
code('git clone https://github.com/JLeongXD/AIROST2627_MoneyLai.git\ncd AIROST2627_MoneyLai/web\nnpm ci\nCopy-Item .env.example .env.local')
p('Run these commands in PowerShell. Keep package-lock.json so npm ci installs the repository’s locked dependency versions. Application commands run from web; database scripts are in the sibling supabase directory.')
h('1 3 Configure environment variables')
code('NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY\nSUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_SERVICE_ROLE_KEY\nGEMINI_API_KEY=YOUR_GEMINI_API_KEY\nGEMINI_MODEL=gemini-3.5-flash-lite')
p('Put these values in web/.env.local. The two NEXT_PUBLIC values configure the browser client. Keep the service role and Gemini keys on the server only, with no NEXT_PUBLIC prefix. Do not commit .env.local. GEMINI_MODEL is the sample configuration in the repository; select a model available to the project’s API key.')
p('The basic manual claim workflow does not require AI extraction. AI and export server routes require their relevant server configuration. Restart the development server after changing environment variables.')

page('1 Environment setup and installation continued')
h('1 4 Initialise the database')
step('For a new, empty Supabase project, run supabase/SETUP_FRESH.sql in the Supabase Dashboard SQL Editor. This is SQL for Supabase, not a terminal command.')
step('For an existing MoneyLai installation, check the migration history and apply only unapplied scripts in order. The source sequence is 001 through 010, followed by 012 and 013. Do not rerun the fresh setup over existing data.')
step('Migration 012 restores the activity budget model and disables retired procurement operations. Migration 013 adds the receipt assistant. The absence of an active 011 source file is intentional in this checkout.')
step('Create and confirm Member, Treasurer and President accounts through Supabase Auth. Replace the sample emails in BOOTSTRAP_ROLES.sql, then execute that script with administrator access. Use a second Treasurer to review a Treasurer’s own claim.')
p('Keep account enrolment controlled for a single club. New profiles default to member; the interface does not provide self-service role assignment. Storage buckets and access policies are created through migrations, including receipts, payment-proofs, receipt-drafts and activity-exports.')
h('1 5 Start the application')
code('npm run dev')
p('Open http://localhost:3000 and sign in with a configured test account. Check that role-specific navigation appears. To run a production build locally, use npm run build followed by npm start.')
h('1 6 Deploy to Vercel')
p('Import the GitHub repository into Vercel and set Root Directory to web. Use the committed lockfile, npm ci and npm run build. Configure the environment variables in the deployment settings. Apply database migrations separately in Supabase; a frontend deployment does not migrate the database.')
p('Set the Supabase Auth Site URL to the deployed origin. Allow the local and production /auth/callback routes, including the recovery redirect using ?next=/update-password. Configure email delivery and test an actual password reset. Check hosting execution limits against the AI routes, which can take longer than ordinary page requests.')
h('1 7 Installation checks')
p('Confirm successful sign-in, the correct role, visible activities and private file uploads. If a table or RPC is missing, check migrations first. For Gemini HTTP 429, wait or check provider quota; for 403 or 404, check credentials or model access. AI service errors can be bypassed with manual claim entry.')

page('2 Development process')
h('2 1 Requirements and implementation approach')
p('Development was organised around a usable reimbursement journey: define an activity, establish a budget, prepare an expense claim, attach evidence, review the claim and record reimbursement. This made the financial workflow the foundation before adding AI convenience features. Member privacy, separation of duties and traceable decisions guided the permission design.')
p('The implementation evolved in small stages visible in Git history. The initial form, list and draft editing were followed by Supabase authentication, persistent activities, row-level access, the complete reimbursement workflow, President governance and finally receipt assistance and exports. This staged approach allowed each new capability to build on an existing workflow.')
h('2 2 Technology and architecture')
table(['Layer','Implementation'],[
 ('Interface','Next.js 16.4.4 App Router, React 19.3, TypeScript and responsive CSS.'),
 ('Application logic','Named feature pages, reusable UI components, typed domain validation and API helpers.'),
 ('Identity and data','Supabase Auth, PostgreSQL tables, Row Level Security and controlled ml_* RPCs.'),
 ('Server operations','Next.js Route Handlers for Gemini requests, receipt processing and activity export generation.'),
 ('Files and reports','Private Supabase Storage, ExcelJS, pdf-lib and JSZip.')],[1.3,5.4])
p('Browser → Next.js interface → authenticated Supabase reads and database RPCs. Sensitive AI and export work goes through authenticated server routes. The browser session gate controls navigation; database policies and server checks enforce authorisation.')
h('2 3 Source organisation')
code('web/src/app/         Route entries and API handlers\nweb/src/features/    Auth, activities, claims and role workspaces\nweb/src/components/  Shared UI and workflow components\nweb/src/lib/         API, types, validation, AI and reports\nsupabase/migrations/ Ordered schema and permission changes\nweb/tests/           Domain, database, AI and export checks')
p('Keeping route entry files small and feature logic in named modules makes it easier to locate behaviour, reuse forms and test domain rules independently of the interface.')

page('2 Development process continued')
h('2 4 Data model and financial rules')
p('Profiles link authentication identities to roles. Activities hold approved budgets; budget_requests store proposals and decisions. Claims link a claimant to an activity, while attachments, payments, claim_events and claim_clarifications preserve evidence, reimbursement details and review history. Receipt draft, fingerprint and plan records support AI preparation and duplicate warnings.')
p('Available budget equals the activity allocation minus Approved and Paid claims. Submitted claims are pending review and do not reserve funds. Moving an approved claim to paid does not deduct the amount twice. PostgreSQL numeric amounts and transactional approval checks protect financial calculations; UI totals are for display.')
p('Business writes use controlled database functions. Members cannot change roles, approve claims or write payment records directly. A Treasurer cannot approve their own claim. Payment uniqueness and retry handling prevent duplicate reimbursement records. Private files are delivered through temporary signed links.')
h('2 5 AI receipt assistance')
p('The receipt assistant sends one receipt and selected activity context to Gemini after user consent. It extracts merchant, date, currency, total and item lines into validated JSON. Users review the original, choose reimbursable items, explain exclusions or corrections, and confirm the allocation of tax, discount and rounding before applying the result to a draft.')
p('A later AI cross-check compares the evidence with the final claim. File hashes and indexed receipt facts can identify possible duplicate submissions. These are review aids: they do not prove authenticity, fraud or eligibility. Unknown fields remain uncertain, and the Treasurer retains approval authority. Manual entry remains available when AI fails.')
h('2 6 Engineering challenges and refinements')
p('Permission errors were addressed by moving business rules into database RPCs and testing ownership and role boundaries. Integration work linked submission, clarification, review and payment through explicit states and retained events. Mixed personal and activity purchases required item selection and exact allocation rather than using the receipt total automatically.')
p('Provider timeouts and quota errors required bounded retries, clearer feedback and a manual fallback. Role-specific export scopes prevent President summary reports from including private evidence. Responsive layouts, readable font sizes and action feedback make longer workflows easier to follow.')
h('2 7 Verification and release checks')
code('npm run typecheck\nnpm test\nnpm run test:database\nnpm run test:ai\nnpm run test:receipts\nnpm run test:exports\nnpm run build')
p('The suites cover validation, database workflow and permissions, AI response handling, receipt allocation and report contents. Embedded database tests stub Supabase infrastructure; they do not establish live email, HTTP Storage, Gemini or deployment behaviour. Complete a role-by-role end-to-end run against a configured test project before release.')

page('3 Usage')
h('3 1 Sign in and prepare a profile')
step('Open the application and sign in at /login. Use the password recovery option when needed, then follow the email link to /update-password.')
step('Open Profile and check the display name and reimbursement destination. Use fictitious bank or e-wallet details for demonstrations.')
step('Open Activities to view approved allocations, pending claims, reimbursed amounts and remaining budget. Select the correct activity for the expense.')
h('3 2 Prepare a claim manually')
step('Open New claim at /claims/new. Select the activity and enter the amount, purchase date, category and a clear description of the purchase and its club purpose.')
step('Save the draft. Open its detail page and upload the original receipt. JPG, PNG and PDF are supported, up to 5 MB each. A claim allows up to five receipt or supporting attachments.')
step('Check the payout details and evidence, then select Submit for review. Submission requires a registered receipt. Use My claims to search, filter and reopen the claim.')
h('3 3 Use the receipt assistant')
step('Select the activity and one MYR receipt. Confirm consent to send the receipt and activity context to Google Gemini, then select Read receipt with AI.')
step('Compare the extracted fields and line items with the original. Select activity purchases, explain excluded items and resolve any unclear purpose. Correct mistaken values and explain corrections.')
step('Check the receipt total and adjustment method. Confirm that you reviewed the original, then apply the confirmed result to the form. Review the purpose text and save the draft with its original receipt.')
step('Review the saved item calculation and, if useful, run the AI cross-check. Resolve warnings using the original evidence, then submit through the normal workflow.')
h('3 4 Track and revise')
p('Pending review means the claim is submitted; Needs information means the Treasurer requested clarification. Update the available draft and reply to the question before resubmitting. Rejected claims can start a revision. Eligible submitted claims can be withdrawn to draft. Draft deletion is restricted once a claim has submission history, and linked files must be removed first where deletion is allowed.')
p('Awaiting payment means approved; Reimbursed means a payment has been recorded. Open the detail page to view permitted receipts, decision history and payment evidence.')

page('3 Usage continued')
h('3 5 Treasurer review and reimbursement')
step('Open Treasury and select a claim from the pending review queue. Check the activity, amount, purpose, original documents, payout details and available budget. Inspect any AI or duplicate warnings.')
step('Ask for more information when the evidence is incomplete. Otherwise approve the claim, or reject it with a clear reason. Another Treasurer must handle your own claim.')
step('For an approved claim, complete the bank or e-wallet transfer outside MoneyLai. Return to the claim and enter the payment date, reference and proof. Confirm the transfer and record the payment.')
step('Check that the claim is Reimbursed and that its payment history is visible. Do not use Record payment as a substitute for making the transfer.')
h('3 6 Budget approval and President oversight')
p('A Treasurer proposes a new activity or a change to an existing allocation, including a reason. Proposed budget values are the new total allocation, not an increment. The current allocation remains effective while the request is pending.')
p('The President opens budget requests, checks the proposal and approves or rejects it with the appropriate note. Approval applies the new budget and retains the decision history. A request created by a President requires another President to review it. The President workspace provides financial summaries without inheriting access to other members’ private payout details or receipt files.')
h('3 7 Export an activity accountability pack')
p('Open the activity export control as a Treasurer or President. The server creates a ZIP containing an Excel ledger and PDF report. Treasurer evidence packs include authorised original receipts, payment proofs and an evidence manifest; President packs contain summaries. Draft claims are excluded. Assisted claims can include item allocation and revision records for review.')
p('Download the result through its temporary private link. Check any missing-evidence notices before sharing the pack. Export limits include 1,000 claims, 200 evidence files, 50 MB of original evidence and a 60 MB ZIP. Reduce the activity scope or resolve oversized evidence if a limit is reached.')
h('3 8 Demonstration checklist')
p('Create a budget proposal → approve it as President → save a Member claim → attach and submit a receipt → review it as Treasurer → record an external payment → verify the Member timeline → export the activity. Include a clarification case and an over-budget approval attempt to demonstrate the controls.')
p('Current scope is one club and MYR. Automatic bank transfers, partial reimbursements and a general accounting ledger are outside the implemented workflow. High-volume use should add server-side pagination beyond the current recent-record lists.')

page('4 Weekly progress')
p('The weekly entries below retain the reporting dates and progress described in the supplied intern logbook. Commit references provide additional technical evidence of the implementation.')
h('Week 1  2 November 2026')
p('Progress achieved: Defined the scope, main features, user roles and application architecture. Prepared the initial project documentation and established the problem of managing club budgets and reimbursement evidence in one place.')
p('Challenges: Choosing a suitable stack while keeping the initial scope manageable. The core workflow had to be small enough to complete while still covering submission, review and payment records.')
p('Learning: Requirements analysis, project planning and the separation of user responsibilities. The design connected each claim to an activity rather than treating expenses as an unstructured list.')
p('Next steps: Begin backend development, establish persistent data and connect the first claim form.')
link('Evidence from the first implementation commits', 'https://github.com/JLeongXD/AIROST2627_MoneyLai/commit/fae75c0')
p('Follow-up evidence: the repository was created on 3 November; Next.js setup and initial claim operations were committed on 4 November. These commits followed the first reporting date.')
h('Week 2  9 November 2026')
p('Progress achieved: Set up Supabase and the database connection, with limited development time due to other commitments. The early implementation established sign-in, activities, claim lists and editable drafts.')
p('Challenges: Database permissions and linking authenticated users to their own records. Access rules had to allow normal use without exposing another member’s claims.')
p('Learning: Supabase Auth, relational records, Row Level Security and frontend error handling. Persistent data required explicit ownership and state rules beyond the visible form.')
p('Next steps: Complete the core backend for claim management, receipt storage, role permissions and reimbursement records.')
link('Evidence for database policies and migrations', 'https://github.com/JLeongXD/AIROST2627_MoneyLai/commit/085922b')
link('Evidence for claim draft editing', 'https://github.com/JLeongXD/AIROST2627_MoneyLai/commit/981becc')

page('4 Weekly progress continued')
h('Week 3  16 November 2026')
p('Progress achieved: Developed the core backend and connected the claim, review and reimbursement workflows. This established a working basis for private evidence, role restrictions, decision history and payment records.')
p('Challenges: Resolving database permissions and making each feature work consistently with the others. Approval, budget availability and payment recording needed shared rules rather than independent updates.')
p('Learning: Backend validation, Supabase access control and workflow integration. Database enforcement protects financial rules even when users interact with the same records from different screens.')
p('Next steps: Improve the frontend and explore AI-assisted receipt checking.')
link('Evidence for the first complete basic edition', 'https://github.com/JLeongXD/AIROST2627_MoneyLai/commit/33bc8e4')
h('Week 4  24 November 2026')
p('Progress achieved: Improved the login interface, added President oversight and the budget approval workflow, and prepared Gemini AI Claim Check integration. These additions separated budget governance from claim reimbursement.')
p('Challenges: No new blockers were reported in the weekly logbook. Integration and end-to-end testing remained the next work items.')
p('Learning: Role-based access, approval workflows and the integration of an external AI service. AI results needed to remain advisory and distinct from authorised human decisions.')
p('Next steps: Complete and test AI checking, improve remaining screens, exercise the full reimbursement journey and explore useful receipt assistance.')
link('Evidence for President budget approval', 'https://github.com/JLeongXD/AIROST2627_MoneyLai/commit/40be858')
link('Evidence for AI receipt checking', 'https://github.com/JLeongXD/AIROST2627_MoneyLai/commit/1db3b23')
h('Latest implementation update  25 November 2026')
p('Subsequent commits added clearer action feedback, receipt indexing and claim checks, activity accountability exports, and a vision language model receipt reader with item selection and allocation. These extend the Week 4 work. The next validation milestone is a complete deployed run with real test accounts, private uploads, Gemini availability and both export roles.')
link('Receipt reader implementation baseline', 'https://github.com/JLeongXD/AIROST2627_MoneyLai/commit/99ae824')

d.core_properties.title='MoneyLai Technical Documentation'
d.core_properties.author='Tho Jian Leong'
d.core_properties.subject='Technical track project documentation'
d.save(OUT)
print(OUT)
