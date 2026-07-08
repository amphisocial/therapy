#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime

TERMS_VERSION = "2026-07-07"
ROOT = Path.cwd()
PUBLIC = ROOT / "public"


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def backup(path):
    p = Path(path)
    if p.exists():
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        b = p.with_name(f"{p.name}.backup.compliance-{stamp}")
        b.write_text(p.read_text(encoding="utf-8"), encoding="utf-8")


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f"Could not find expected block for {label}")
    return text.replace(old, new, 1)


INDEX_HTML = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TherapyAgent | AI Therapy Documentation</title>
  <meta name="description" content="HIPAA-ready AI-assisted therapy documentation workspace for ABA and I/DD service organizations.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body data-page="public">
  <header class="topbar">
    <div class="brand">
      <div class="mark">TA</div>
      <div>
        <strong>TherapyAgent</strong>
        <span>AI documentation for ABA & I/DD providers</span>
      </div>
    </div>
    <nav id="publicNav">
      <a href="/security-compliance.html">Security & Compliance</a>
      <a href="/business-associate-agreement.html">BAA Template</a>
      <a href="/terms.html">Terms</a>
      <a href="/workspace.html">Workspace</a>
      <button id="openAuth" class="btn small">Login</button>
    </nav>
    <div id="userNav" class="user-nav" hidden>
      <span id="welcomeUser">Welcome</span>
      <button id="logoutBtn" class="btn small secondary">Logoff</button>
    </div>
  </header>

  <main>
    <section class="hero public-section">
      <div class="hero-copy">
        <div class="pill">Voice-first • Multi-tenant • HIPAA-ready architecture</div>
        <h1>Turn therapy conversations into structured, reviewable records.</h1>
        <p>TherapyAgent helps ABA and I/DD service organizations capture sessions, behavior events, plans, incidents, AI-assisted reports, and secure attachments with role-based access, review workflow, and audit context.</p>
        <div class="hero-actions">
          <button class="btn" id="heroLogin">Login to workspace</button>
          <a class="btn secondary" href="/security-compliance.html">Review Security</a>
        </div>
      </div>
      <div class="hero-card">
        <strong>Designed for responsible clinical documentation</strong>
        <p>Draft → Under Review → Reviewed or Rejected → Resubmitted, with clinician oversight and secure S3 attachment storage.</p>
      </div>
    </section>

    <section class="compliance public-section" id="security">
      <p class="eyebrow">Security posture</p>
      <h2>Built around org isolation, auditability, encryption, and clinician control.</h2>
      <div class="compliance-grid">
        <div><strong>Encrypted storage</strong><span>Attachments are stored in AWS S3 using server-side KMS encryption when configured, with organization-specific prefixes.</span></div>
        <div><strong>Access controls</strong><span>Role-based access, optional MFA, authenticated downloads, and least-privilege EC2 IAM role access to S3.</span></div>
        <div><strong>Audit workflow</strong><span>Created, modified, reviewed, rejected, uploaded, and administrative events are logged for operational traceability.</span></div>
        <div><strong>HIPAA-ready operations</strong><span>BAA template, security controls, and deployment patterns intended to support covered entities and business associates.</span></div>
      </div>
    </section>
  </main>

  <div class="modal" id="authModal" aria-hidden="true">
    <div class="modal-card auth-card">
      <button class="x" id="closeAuth" aria-label="Close authentication dialog">×</button>
      <div class="auth-layout">
        <aside class="auth-side"><p class="eyebrow">Secure access</p><h2>Login or create account.</h2><p>MFA is optional for invited users and recommended for clinical workspaces. Administrators are responsible for authorized users and appropriate use of PHI.</p></aside>
        <section class="auth-main">
          <div class="auth-tabs" role="tablist"><button class="auth-tab active" data-auth-screen="login" type="button">Login</button><button class="auth-tab" data-auth-screen="register" type="button">Create Account</button><button class="auth-tab" data-auth-screen="forgot" type="button">Forgot Password</button></div>
          <div id="authMessage" class="auth-message" aria-live="polite"></div>
          <section class="auth-screen active" id="auth-login"><h3>Login</h3><form id="loginForm" class="auth-form"><label>Email / Login<input name="email" type="email" required autocomplete="email"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label><label>MFA code<input name="totp" inputmode="numeric" placeholder="6-digit code"></label><button class="btn">Login</button></form></section>
          <section class="auth-screen" id="auth-register"><h3>Create Account</h3><form id="registerForm" class="auth-form"><label>Organization<input id="orgSearch" name="organizationName" list="organizationOptions" required autocomplete="organization"><input id="organizationId" name="organizationId" type="hidden"><datalist id="organizationOptions"></datalist><small id="orgHint">Type at least 2 characters to search or create a new organization.</small></label><div class="two"><label>First name<input name="firstName" required></label><label>Last name<input name="lastName" required></label></div><label>Email / Login<input name="email" type="email" required></label><label>Password<input name="password" type="password" required minlength="10"></label><label class="check legal-check"><input name="termsAccepted" type="checkbox" required> <span>I have read and agree to the <a href="/terms.html" target="_blank" rel="noopener">TherapyAgent Terms and Conditions</a>, including obligations for authorized use, PHI handling, and organization administrator responsibility.</span></label><button class="btn">Create account</button></form><div id="mfaSetupPanel" class="mfa-panel" hidden><h4>Enable MFA</h4><p>Add account manually in your Authenticator app using this setup key:</p><code id="mfaSecret"></code><form id="mfaForm" class="auth-form"><label>6-digit MFA code<input name="totp" required inputmode="numeric"></label><button class="btn">Verify MFA</button><button class="btn secondary" type="button" id="goLoginAfterMfa">Go to Login</button></form></div></section>
          <section class="auth-screen" id="auth-forgot"><h3>Forgot Password</h3><form id="forgotForm" class="auth-form"><label>Email / Login<input name="email" type="email" required></label><button class="btn">Request reset</button></form></section>
        </section>
      </div>
    </div>
  </div>

  <script src="/app.js"></script>
</body>
</html>
'''

SECURITY_HTML = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Security & Compliance | TherapyAgent</title>
  <meta name="description" content="TherapyAgent security, privacy, and HIPAA-ready architecture for therapy documentation workflows.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body data-page="public">
  <header class="topbar">
    <div class="brand"><div class="mark">TA</div><div><strong>TherapyAgent</strong><span>Security & Compliance</span></div></div>
    <nav id="publicNav"><a href="/">Home</a><a href="/security-compliance.html">Security & Compliance</a><a href="/business-associate-agreement.html">BAA Template</a><a href="/terms.html">Terms</a><a href="/workspace.html">Workspace</a></nav>
  </header>
  <main class="legal-page">
    <section class="legal-hero">
      <p class="eyebrow">Security & Compliance</p>
      <h1>HIPAA-ready documentation infrastructure for therapy organizations.</h1>
      <p>TherapyAgent is designed to support ABA, I/DD, and therapy organizations that need structured documentation, auditability, secure file storage, and responsible clinician-reviewed AI assistance.</p>
      <p class="notice"><strong>Important:</strong> HIPAA compliance is a shared operational responsibility. TherapyAgent provides technical and contractual controls intended to support covered entities and business associates, but each customer remains responsible for its own HIPAA policies, workforce training, access decisions, risk analysis, and permitted uses of PHI.</p>
    </section>

    <section class="legal-section">
      <h2>Security controls currently implemented</h2>
      <div class="legal-grid">
        <div><h3>Encryption in transit</h3><p>Production deployments should be served only over HTTPS/TLS. Browser-to-application and application-to-cloud traffic should remain encrypted in transit.</p></div>
        <div><h3>Encrypted file storage</h3><p>Attachments are stored in AWS S3 with server-side encryption using AWS KMS when <code class="inline-code">S3_KMS_KEY_ID</code> is configured.</p></div>
        <div><h3>HIPAA-ready AWS storage pattern</h3><p>The storage design uses HIPAA-eligible AWS services when deployed under an appropriate AWS Business Associate Addendum, with S3 bucket policies, KMS encryption, private objects, and least-privilege IAM role access.</p></div>
        <div><h3>EC2 IAM role credentials</h3><p>The S3 integration supports EC2 instance role credentials, avoiding long-lived AWS secret keys in application configuration.</p></div>
        <div><h3>Organization isolation</h3><p>Users, patients, records, review history, and files are scoped by organization. Attachments are stored under organization-specific S3 prefixes.</p></div>
        <div><h3>Role-based access</h3><p>Users are assigned roles such as org admin, BCBA, supervisor, therapist, RBT, billing auditor, and read-only.</p></div>
        <div><h3>MFA support</h3><p>MFA is available and recommended. The deployment can later enforce MFA using environment configuration.</p></div>
        <div><h3>Audit logging</h3><p>Key actions such as record creation, updates, review actions, user administration, file upload, and S3 setup are written to audit history.</p></div>
        <div><h3>Authenticated downloads</h3><p>Attachment downloads require a valid TherapyAgent session token and are streamed through the application after organization-level authorization.</p></div>
        <div><h3>Clinician-reviewed AI</h3><p>AI assistance drafts documentation for review. TherapyAgent should not be used as an autonomous diagnosis, treatment, or medical necessity determination system.</p></div>
      </div>
    </section>

    <section class="legal-section">
      <h2>HIPAA, BAA, and customer responsibilities</h2>
      <p>When TherapyAgent handles protected health information for a covered entity, the parties should execute a Business Associate Agreement before production PHI is entered. A draft template is available here: <a href="/business-associate-agreement.html">Business Associate Agreement Template</a>.</p>
      <ul>
        <li>Customers are responsible for determining whether they are covered entities or business associates.</li>
        <li>Customers are responsible for appropriate user provisioning, minimum necessary access, workforce training, patient consent workflows, and local policies.</li>
        <li>TherapyAgent administrators should add only authorized workforce members or contractors and attest to the Terms for each invited user.</li>
        <li>Production deployments should include backups, monitoring, incident response procedures, and periodic access reviews.</li>
      </ul>
    </section>

    <section class="legal-section">
      <h2>Procurement-ready documentation</h2>
      <p>Available or planned materials include Terms and Conditions, BAA template, security overview, encryption architecture, incident response outline, and audit/access-control evidence.</p>
      <div class="form-actions"><a class="btn" href="/terms.html">View Terms</a><a class="btn secondary" href="/business-associate-agreement.html">View BAA Template</a></div>
    </section>
  </main>
</body>
</html>
'''

TERMS_HTML = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Terms and Conditions | TherapyAgent</title>
  <meta name="description" content="TherapyAgent Terms and Conditions for therapy documentation software.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body data-page="public">
  <header class="topbar">
    <div class="brand"><div class="mark">TA</div><div><strong>TherapyAgent</strong><span>Terms and Conditions</span></div></div>
    <nav id="publicNav"><a href="/">Home</a><a href="/security-compliance.html">Security & Compliance</a><a href="/business-associate-agreement.html">BAA Template</a><a href="/workspace.html">Workspace</a></nav>
  </header>
  <main class="legal-page">
    <section class="legal-hero">
      <p class="eyebrow">Terms Version 2026-07-07</p>
      <h1>TherapyAgent Terms and Conditions</h1>
      <p>These Terms govern access to and use of TherapyAgent, an AI-assisted documentation and workflow platform for therapy organizations. These Terms are intended for U.S.-based use and should be reviewed by counsel before commercial launch.</p>
    </section>

    <section class="legal-section">
      <h2>1. Acceptance and authority</h2>
      <p>By creating an account, logging in, or using TherapyAgent, you agree to these Terms. If you register on behalf of an organization, you represent that you are authorized to bind that organization. Organization administrators who create users attest that those users are authorized to access the organization workspace and will use TherapyAgent under these Terms and applicable organization policies.</p>

      <h2>2. Service description</h2>
      <p>TherapyAgent provides structured documentation workflows for patients, session logs, behavior events, therapy plans, incidents, AI-assisted reports, review workflows, audit history, and secure attachments. TherapyAgent is a documentation and workflow tool; it does not replace professional judgment, supervision, clinical review, diagnosis, treatment planning, payer authorization, or medical necessity determinations.</p>

      <h2>3. Healthcare and HIPAA responsibilities</h2>
      <p>If Customer is a HIPAA covered entity or business associate and uses TherapyAgent with protected health information, the parties should execute a Business Associate Agreement before production PHI is entered. Customer is responsible for determining whether HIPAA or other health privacy laws apply, configuring appropriate user access, training workforce members, obtaining required consents and authorizations, and using TherapyAgent only for permitted purposes.</p>

      <h2>4. Authorized users and account security</h2>
      <p>Customer is responsible for all activity under its organization workspace and user accounts. Users must keep credentials confidential, use MFA where required or appropriate, and promptly report suspected compromise. Administrators must remove or deactivate users who no longer require access.</p>

      <h2>5. Customer data and PHI</h2>
      <p>Customer retains ownership of data entered into TherapyAgent. TherapyAgent may process Customer data only to provide, secure, maintain, support, and improve the service, and as otherwise permitted by a written agreement. Customer must not enter data it is not authorized to use or disclose.</p>

      <h2>6. AI-assisted documentation</h2>
      <p>AI outputs may be incomplete, inaccurate, or inappropriate for a clinical record without review. Customer and its authorized clinicians are responsible for reviewing, editing, approving, and validating all AI-assisted content before relying on it or placing it into the clinical record.</p>

      <h2>7. Prohibited use</h2>
      <ul>
        <li>Do not use TherapyAgent for unlawful, abusive, or unauthorized purposes.</li>
        <li>Do not attempt to bypass authentication, authorization, organization isolation, audit logging, storage protections, or rate limits.</li>
        <li>Do not use TherapyAgent to make autonomous clinical, diagnostic, treatment, billing, or emergency decisions.</li>
        <li>Do not upload malware, illegal content, or content that violates third-party rights.</li>
      </ul>

      <h2>8. Security</h2>
      <p>TherapyAgent implements technical safeguards such as role-based access, audit logging, HTTPS deployment expectations, encrypted S3 storage with KMS when configured, and least-privilege cloud access patterns. No system can be guaranteed completely secure. Customer must maintain reasonable administrative and operational safeguards for its own environment and workforce.</p>

      <h2>9. Availability and support</h2>
      <p>Unless a separate written agreement states otherwise, TherapyAgent is provided without a guaranteed uptime commitment. Planned maintenance, cloud provider outages, security events, or upgrades may affect availability.</p>

      <h2>10. Fees and subscriptions</h2>
      <p>Fees, subscription terms, usage limits, and payment terms will be specified in an order form, invoice, online plan, or separate agreement. Failure to pay may result in suspension or termination as permitted by law and agreement.</p>

      <h2>11. Confidentiality</h2>
      <p>Each party may receive confidential information from the other. The receiving party must protect confidential information using reasonable care and use it only for purposes related to the service, except as required by law.</p>

      <h2>12. Business Associate Agreement</h2>
      <p>If a BAA is required, the BAA controls over these Terms with respect to PHI if there is a conflict. A sample template is available at <a href="/business-associate-agreement.html">Business Associate Agreement Template</a>.</p>

      <h2>13. Disclaimers</h2>
      <p>Except as expressly stated in a written agreement, TherapyAgent is provided “as is” and “as available.” TherapyAgent disclaims warranties of merchantability, fitness for a particular purpose, non-infringement, uninterrupted operation, and error-free output to the maximum extent permitted by law.</p>

      <h2>14. Limitation of liability</h2>
      <p>To the maximum extent permitted by law, TherapyAgent will not be liable for indirect, incidental, consequential, special, exemplary, or punitive damages, or lost profits, revenues, goodwill, or data. Any aggregate liability will be limited to amounts paid for the service during the period specified in the applicable order form or written agreement.</p>

      <h2>15. Suspension and termination</h2>
      <p>TherapyAgent may suspend access to protect the service, comply with law, address security risk, or respond to non-payment or material breach. Customer may stop using the service at any time, subject to any payment or contractual obligations.</p>

      <h2>16. Governing law</h2>
      <p>Unless an order form or written agreement states otherwise, these Terms are governed by the laws of the United States and the laws of the Commonwealth of Virginia, without regard to conflict-of-law rules. The parties will attempt in good faith to resolve disputes informally before initiating formal proceedings.</p>

      <h2>17. Changes to Terms</h2>
      <p>TherapyAgent may update these Terms from time to time. Material changes should be communicated through the website, product, email, or other reasonable means. Continued use after the effective date constitutes acceptance of the updated Terms.</p>

      <h2>18. Contact</h2>
      <p>For legal, security, or compliance questions, contact the TherapyAgent service provider identified in your order form or pilot agreement.</p>
    </section>
  </main>
</body>
</html>
'''

BAA_HTML = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Business Associate Agreement Template | TherapyAgent</title>
  <meta name="description" content="TherapyAgent Business Associate Agreement template for HIPAA covered entities and business associates.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body data-page="public">
  <header class="topbar">
    <div class="brand"><div class="mark">TA</div><div><strong>TherapyAgent</strong><span>BAA Template</span></div></div>
    <nav id="publicNav"><a href="/">Home</a><a href="/security-compliance.html">Security & Compliance</a><a href="/terms.html">Terms</a><a href="/workspace.html">Workspace</a></nav>
  </header>
  <main class="legal-page">
    <section class="legal-hero">
      <p class="eyebrow">Template for counsel review</p>
      <h1>Business Associate Agreement Template</h1>
      <p>This template is a starting point for U.S. HIPAA-covered customers and should be reviewed and adapted by legal counsel before signing.</p>
    </section>

    <section class="legal-section contract-template">
      <h2>Business Associate Agreement</h2>
      <p>This Business Associate Agreement (“BAA”) is entered into by and between <strong>[Covered Entity / Customer Name]</strong> (“Covered Entity”) and <strong>[TherapyAgent Service Provider Legal Name]</strong> (“Business Associate”) as of <strong>[Effective Date]</strong>.</p>

      <h3>1. Purpose</h3>
      <p>Business Associate provides software services that may involve creating, receiving, maintaining, or transmitting Protected Health Information (“PHI”) on behalf of Covered Entity. The parties enter into this BAA to comply with HIPAA, HITECH, and applicable implementing regulations.</p>

      <h3>2. Definitions</h3>
      <p>Terms such as “Business Associate,” “Covered Entity,” “Protected Health Information,” “Electronic Protected Health Information,” “Security Incident,” “Breach,” “Subcontractor,” and “Unsecured PHI” have the meanings given under HIPAA unless otherwise defined in this BAA.</p>

      <h3>3. Permitted uses and disclosures</h3>
      <p>Business Associate may use or disclose PHI only as necessary to provide the services, as permitted by the underlying services agreement, as required by law, and as otherwise permitted by this BAA. Business Associate may use PHI for proper management and administration and to carry out legal responsibilities, subject to HIPAA limits.</p>

      <h3>4. Safeguards</h3>
      <p>Business Associate will use appropriate administrative, physical, and technical safeguards designed to protect the confidentiality, integrity, and availability of ePHI and prevent uses or disclosures not permitted by this BAA.</p>

      <h3>5. Reporting</h3>
      <p>Business Associate will report to Covered Entity any Breach of Unsecured PHI without unreasonable delay and in no case later than <strong>[__]</strong> calendar days after discovery. Business Associate will also report Security Incidents as required by HIPAA and as further specified in the services agreement.</p>

      <h3>6. Subcontractors</h3>
      <p>Business Associate will ensure that any subcontractor that creates, receives, maintains, or transmits PHI on behalf of Business Associate agrees in writing to substantially similar restrictions and safeguards.</p>

      <h3>7. Access, amendment, and accounting</h3>
      <p>To the extent required by HIPAA and reasonably requested by Covered Entity, Business Associate will assist Covered Entity in responding to individual requests for access, amendment, and accounting of disclosures.</p>

      <h3>8. Minimum necessary</h3>
      <p>Business Associate will request, use, and disclose only the minimum necessary PHI needed to perform the services, except as otherwise permitted or required by law.</p>

      <h3>9. Internal practices and government access</h3>
      <p>Business Associate will make its internal practices, books, and records relating to the use and disclosure of PHI available to the Secretary of HHS as required by HIPAA.</p>

      <h3>10. Return or destruction of PHI</h3>
      <p>Upon termination, Business Associate will return or destroy PHI if feasible. If return or destruction is not feasible, Business Associate will extend the protections of this BAA to the retained PHI and limit further uses and disclosures to the purposes that make return or destruction infeasible.</p>

      <h3>11. Term and termination</h3>
      <p>This BAA remains in effect while Business Associate maintains PHI on behalf of Covered Entity. Covered Entity may terminate this BAA and the related services agreement if Business Associate materially breaches this BAA and fails to cure within a reasonable cure period, if cure is possible.</p>

      <h3>12. Order of precedence</h3>
      <p>If this BAA conflicts with another agreement between the parties, this BAA controls with respect to PHI and HIPAA obligations.</p>

      <h3>13. Signatures</h3>
      <p><strong>Covered Entity:</strong> ___________________________ Date: ____________</p>
      <p><strong>Business Associate:</strong> _________________________ Date: ____________</p>
    </section>
  </main>
</body>
</html>
'''

LEGAL_CSS = '''

/* Legal, security, and compliance pages */
.legal-page{max-width:1180px;margin:0 auto 80px;padding:42px 28px}.legal-hero{background:white;border:1px solid var(--line);border-radius:28px;padding:34px;box-shadow:var(--shadow);margin-bottom:22px}.legal-hero h1{font-size:clamp(34px,4vw,58px);line-height:1.05;letter-spacing:-.04em;color:var(--blue-900);margin:18px 0}.legal-hero p{font-size:17px;line-height:1.7;color:#42526b}.legal-section{background:white;border:1px solid var(--line);border-radius:24px;padding:28px;margin:18px 0;box-shadow:0 12px 50px rgba(8,32,74,.06)}.legal-section h2{color:var(--blue-900);margin-top:20px}.legal-section h2:first-child{margin-top:0}.legal-section h3{color:var(--blue-800);margin-bottom:6px}.legal-section p,.legal-section li{line-height:1.72;color:#334155}.legal-section a{color:var(--blue-700);font-weight:800}.legal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.legal-grid div{background:var(--blue-050);border:1px solid var(--line);border-radius:16px;padding:18px}.legal-check{font-size:13px;line-height:1.45;align-items:flex-start}.legal-check span{font-weight:700;color:#334155}.legal-check a{color:var(--blue-700);text-decoration:underline}.contract-template strong{color:var(--blue-900)}@media(max-width:900px){.legal-grid{grid-template-columns:1fr}.legal-page{padding:24px 16px}.legal-hero,.legal-section{padding:22px}}
'''


def patch_index():
    path = PUBLIC / "index.html"
    backup(path)
    write(path, INDEX_HTML)


def patch_workspace():
    path = PUBLIC / "workspace.html"
    backup(path)
    s = read(path)
    s = s.replace('<span id="welcomeUser">Welcome</span>\n      <button id="logoutBtn" class="btn small secondary">Logoff</button>', '<a href="/security-compliance.html">Security</a>\n      <a href="/terms.html">Terms</a>\n      <span id="welcomeUser">Welcome</span>\n      <button id="logoutBtn" class="btn small secondary">Logoff</button>')
    old = '''              <label>Role<select name="role" class="roleSelect"></select></label>
            </div>
            <div class="form-actions"><button class="btn">Create user</button></div>'''
    new = '''              <label>Role<select name="role" class="roleSelect"></select></label>
              <label class="check legal-check span-2"><input name="adminTermsAttested" type="checkbox" required> <span>I attest that this user is authorized by our organization to use TherapyAgent and will operate under our organization policies and the <a href="/terms.html" target="_blank" rel="noopener">TherapyAgent Terms and Conditions</a>.</span></label>
            </div>
            <div class="form-actions"><button class="btn">Create user</button></div>'''
    if old in s and 'adminTermsAttested' not in s:
        s = s.replace(old, new, 1)
    elif 'adminTermsAttested' not in s:
        raise RuntimeError('Could not patch workspace admin attestation checkbox')
    write(path, s)


def patch_app_js():
    path = PUBLIC / "app.js"
    backup(path)
    s = read(path)
    old = '''  const body = formBody(e.target);
  if (!body.organizationId) delete body.organizationId;'''
    new = '''  const body = formBody(e.target);
  if (body.termsAccepted !== "on") {
    setAuthMessage("You must agree to the TherapyAgent Terms and Conditions before creating an account.", "error");
    return;
  }
  if (!body.organizationId) delete body.organizationId;'''
    if 'body.termsAccepted !== "on"' not in s:
        s = replace_once(s, old, new, 'public registration terms validation')

    old = '''  const body = formBody(e.target);
  const validation = passwordRuleErrors(body.initialPassword || "").length ? passwordRulesMessage() : "";'''
    new = '''  const body = formBody(e.target);
  if (body.adminTermsAttested !== "on") {
    $("#inviteOutput").hidden = false;
    $("#inviteOutput").textContent = "You must attest that the invited user is authorized and covered by the TherapyAgent Terms and Conditions.";
    return;
  }
  const validation = passwordRuleErrors(body.initialPassword || "").length ? passwordRulesMessage() : "";'''
    if 'body.adminTermsAttested !== "on"' not in s:
        s = replace_once(s, old, new, 'admin user terms attestation validation')
    write(path, s)


def patch_server():
    path = ROOT / "server.js"
    backup(path)
    s = read(path)

    if 'const TERMS_VERSION =' not in s:
        s = replace_once(s, 'const S3_FORCE_PATH_STYLE = String(process.env.S3_FORCE_PATH_STYLE || "false").toLowerCase() === "true";\n', 'const S3_FORCE_PATH_STYLE = String(process.env.S3_FORCE_PATH_STYLE || "false").toLowerCase() === "true";\nconst TERMS_VERSION = process.env.TERMS_VERSION || "2026-07-07";\n', 'TERMS_VERSION constant')

    if 'termsAccepted' not in s[s.find('app.post("/api/register"'):s.find('app.post("/api/login"')]:
        s = replace_once(s, 'app.post("/api/register", async (req, res) => {\n', 'app.post("/api/register", async (req, res) => {\n  if (!toBoolean(req.body?.termsAccepted)) return res.status(400).json({ error: "terms_required", message: "You must agree to the TherapyAgent Terms and Conditions before creating an account." });\n', 'register terms check')

    old = '''    const user = (await client.query(
      `INSERT INTO users (org_id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, active)
       VALUES ($1,$2,$3,$4,$5,$6,false,$7)
       RETURNING id, org_id, email, full_name, role, mfa_enabled, must_change_password, active`,
      [org.id, normalizedEmail, fullName, hash, role, secret.base32, active]
    )).rows[0];'''
    new = '''    const user = (await client.query(
      `INSERT INTO users (org_id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, active, terms_accepted_at, terms_accepted_ip, terms_accepted_user_agent, terms_version)
       VALUES ($1,$2,$3,$4,$5,$6,false,$7,now(),$8,$9,$10)
       RETURNING id, org_id, email, full_name, role, mfa_enabled, must_change_password, active`,
      [org.id, normalizedEmail, fullName, hash, role, secret.base32, active, req.ip, req.get("user-agent") || "", TERMS_VERSION]
    )).rows[0];'''
    if 'terms_accepted_ip' not in s[s.find('app.post("/api/register"'):s.find('app.post("/api/login"')]:
        s = replace_once(s, old, new, 'register user insert terms columns')

    if 'adminTermsAttested' not in s[s.find('app.post("/api/admin/users"'):s.find('app.patch("/api/admin/users/:id"')]:
        s = replace_once(s, '  const initialPassword = String(req.body?.initialPassword || "").trim();\n', '  const initialPassword = String(req.body?.initialPassword || "").trim();\n  if (!toBoolean(req.body?.adminTermsAttested)) return res.status(400).json({ error: "admin_terms_attestation_required", message: "You must attest that the invited user is authorized and covered by the TherapyAgent Terms and Conditions." });\n', 'admin terms attestation check')

    old = '''  const row = (await pool.query(
    `INSERT INTO users (org_id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, must_change_password, active, invited_by, invited_at)
     VALUES ($1,$2,$3,$4,$5,$6,false,true,true,$7,now())
     RETURNING id, email, full_name, role, active, mfa_enabled, must_change_password, created_at`,
    [req.user.org_id, email, fullName, hash, role, secret.base32, req.user.id]
  )).rows[0];'''
    new = '''  const row = (await pool.query(
    `INSERT INTO users (org_id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, must_change_password, active, invited_by, invited_at, terms_accepted_by_admin_id, terms_admin_attested_at, terms_admin_attestation, terms_version)
     VALUES ($1,$2,$3,$4,$5,$6,false,true,true,$7,now(),$8,now(),$9,$10)
     RETURNING id, email, full_name, role, active, mfa_enabled, must_change_password, created_at`,
    [req.user.org_id, email, fullName, hash, role, secret.base32, req.user.id, req.user.id, "Organization admin attested that this user is authorized and covered by the TherapyAgent Terms and Conditions.", TERMS_VERSION]
  )).rows[0];'''
    if 'terms_admin_attestation' not in s[s.find('app.post("/api/admin/users"'):s.find('app.patch("/api/admin/users/:id"')]:
        s = replace_once(s, old, new, 'admin user insert terms attestation columns')

    write(path, s)


def patch_schema():
    path = ROOT / "db" / "schema.sql"
    backup(path)
    s = read(path)
    additions = '''
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_ip TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_user_agent TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_by_admin_id UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_admin_attested_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_admin_attestation TEXT;
'''
    if 'terms_accepted_at' not in s:
        s = replace_once(s, 'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_invite_email_at TIMESTAMPTZ;\n', 'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_invite_email_at TIMESTAMPTZ;\n' + additions, 'terms columns in schema')
    write(path, s)


def patch_styles():
    path = PUBLIC / "styles.css"
    backup(path)
    s = read(path)
    if '/* Legal, security, and compliance pages */' not in s:
        s += LEGAL_CSS
    write(path, s)


def write_new_pages():
    PUBLIC.mkdir(exist_ok=True)
    for name, content in {
        'security-compliance.html': SECURITY_HTML,
        'terms.html': TERMS_HTML,
        'business-associate-agreement.html': BAA_HTML,
    }.items():
        path = PUBLIC / name
        backup(path)
        write(path, content)


def main():
    required = [ROOT / 'server.js', PUBLIC / 'index.html', PUBLIC / 'workspace.html', PUBLIC / 'app.js', PUBLIC / 'styles.css', ROOT / 'db' / 'schema.sql']
    missing = [str(p) for p in required if not p.exists()]
    if missing:
        raise SystemExit('Run this from the TherapyAgent repo root. Missing: ' + ', '.join(missing))
    patch_index()
    patch_workspace()
    patch_app_js()
    patch_server()
    patch_schema()
    patch_styles()
    write_new_pages()
    print('Compliance / Terms / BAA update applied.')
    print('Next: node --check server.js && node --check public/app.js && psql "$DATABASE_URL" -f db/schema.sql')


if __name__ == '__main__':
    main()
