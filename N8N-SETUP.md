# Genio AI — n8n Local Automation Setup Guide

This guide walks you through setting up **local n8n** to power all the sidebar automations in Genio AI (leave applications, IT tickets, email notifications, and more).

---

## What You'll Set Up

- Local n8n instance running on `http://localhost:5678`
- A single workflow that handles **14 automation types**
- Gmail OAuth2 integration to send emails automatically
- Two emails per action: one to the relevant team, one confirmation to the employee

---

## Step 1 — Install n8n Locally

You need **Node.js 18+** installed. Then run:

```bash
# Option A: Install globally (recommended)
npm install -g n8n

# Option B: Run without installing
npx n8n
```

Start n8n:
```bash
n8n start
```

n8n will open at: **http://localhost:5678**

---

## Step 2 — Import the Workflow

1. Open n8n at http://localhost:5678
2. Click **"Add workflow"** or the **+** button
3. Click the **⋮ menu** (top right) → **"Import from file"**
4. Select the file: `n8n-workflow.json` from this project folder
5. The workflow "**Genio AI – All Automations**" will appear with 5 nodes

---

## Step 3 — Set Up Gmail OAuth2

1. In n8n, go to **Settings → Credentials**
2. Click **"Add Credential"**
3. Search for and select **"Gmail OAuth2"**
4. Follow the OAuth2 setup:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a project (or use an existing one)
   - Enable the **Gmail API**
   - Create **OAuth 2.0 credentials** (Desktop App type)
   - Copy the **Client ID** and **Client Secret** into n8n
5. Click **"Sign in with Google"** and authorise the account you want to send emails FROM
6. Save the credential — name it **"Gmail OAuth2"**

> **Tip:** The Gmail account you authorise will be the "From" address for all automated emails.

---

## Step 4 — Connect Gmail to the Workflow

1. Open the imported workflow
2. Click the **"Send to Team"** node
3. Under **Credential**, select your **"Gmail OAuth2"** credential
4. Click the **"Send Confirmation to User"** node
5. Select the same credential
6. Click **Save** (top right)

---

## Step 5 — Configure Team Email Addresses

Open the **"Format Email"** node (Code node) and update the email addresses at the top:

```javascript
const HR_EMAIL         = 'hr@yourcompany.com';          // ← Change this
const IT_EMAIL         = 'it-support@yourcompany.com';  // ← Change this
const ADMIN_EMAIL      = 'admin@yourcompany.com';        // ← Change this
const COMPLIANCE_EMAIL = 'compliance@yourcompany.com';   // ← Change this
const FEEDBACK_EMAIL   = 'feedback@yourcompany.com';     // ← Change this
```

Save the workflow.

---

## Step 6 — Activate the Workflow

1. In the workflow editor, toggle the **"Active"** switch (top right) to ON
2. The webhook is now live at:
   ```
   http://localhost:5678/webhook/genio-action
   ```

---

## Step 7 — Run Genio AI

Start your Next.js app:
```bash
npm run dev
```

Open http://localhost:3000, log in, and click any sidebar button — a form will appear, and on submit, emails are sent automatically! ✅

---

## Optional — Environment Variable

To customise the n8n webhook URL (e.g. different port), create a `.env.local` file in the project root:

```env
NEXT_PUBLIC_LOCAL_N8N_URL=http://localhost:5678/webhook/genio-action
```

---

## Email Flow Summary

| Action | Email sent TO | CC |
|---|---|---|
| Apply for Leave | hr@company.com | Employee |
| HR Policies | hr@company.com | Employee |
| Payroll Query | hr@company.com | Employee |
| Benefits | hr@company.com | Employee |
| Training Request | hr@company.com | Employee |
| Raise IT Ticket | it-support@company.com | Employee |
| Access Request | it-support@company.com | Employee |
| Software Request | it-support@company.com | Employee |
| Book a Room | admin@company.com | Employee |
| Travel Request | admin@company.com | Employee |
| Office Supplies | admin@company.com | Employee |
| Facilities | admin@company.com | Employee |
| Compliance Query | compliance@company.com | Employee |
| Submit Feedback | feedback@company.com | — |

---

## Troubleshooting

**"Could not connect to local n8n"**
→ Make sure n8n is running: `n8n start`
→ Check the workflow is **Active** in n8n

**"Gmail authentication failed"**
→ Re-authorise the Gmail credential in n8n Settings → Credentials

**Emails not arriving**
→ Check the n8n execution log (click on the workflow → Executions tab)
→ Verify email addresses in the Format Email code node

**CORS error in browser console**
→ The webhook node already has `allowedOrigins: "*"` set. If you still see CORS errors, restart n8n.
