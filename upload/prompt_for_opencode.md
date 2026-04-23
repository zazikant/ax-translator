# Second Brain (RAG Document Assistant) - Usage Guide

**Base URL:** `https://rag-document-assistant-three.vercel.app`

A RAG system for storing, querying, and retrieving project knowledge.

---

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/ingest` | Ingest raw text document |
| POST | `/api/upload` | Upload PDF, text, or manage (Add/Replace/Delete) |
| POST | `/api/query` | Query the knowledge base |
| GET | `/api/documents` | List all documents |
| DELETE | `/api/index/reset` | Reset/delete ALL documents |

---

## 1. Query (Before Every Step)

**ALWAYS query secondbrain before making decisions or implementing features.**

```powershell
$queryBody = @{
    query = "your question here"
    mode = "conversational"  # or "precise"
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/query' -Method POST -ContentType 'application/json' -Body $queryBody
```

| Mode | topK | When to Use |
|------|------|-------------|
| `conversational` | 12 | Broad exploration, context gathering |
| `precise` | 5 | Specific facts, exact answers |

**With filters:**
```powershell
$queryBody = @{
    query = "your question"
    top_k = 8
    filters = @{
        doc_type = "feature"
        project = "ms-graph-email-project"
    }
} | ConvertTo-Json
```

**Script location:** `D:\test\query-secondbrain.ps1`

---

## 2. Ingest Document (raw text)

Add new document with metadata:

```powershell
$content = @"
# Document Title

Your content here...
"@

$body = @{
    content = $content
    filename = "descriptive-name.md"
    metadata = @{
        doc_type = "feature"  # feature, decision, security, bug, architecture, sop
        project = "project-name"
        version = "1.0"
    }
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/ingest' -Method POST -ContentType 'application/json' -Body $body
```

**Script location:** `D:\test\ingest-feature.ps1`

---

## 3. Upload (Add/Replace/Delete)

### Add - Upload new document
```powershell
$body = @{
    type = "text"
    content = "Your content here"
    name = "filename.txt"
    mode = "Add"
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/upload' -Method POST -ContentType 'application/json' -Body $body
```

### Replace - Update existing document (same filename)
```powershell
$body = @{
    type = "text"
    content = "Updated content here"
    name = "filename.txt"  # Same filename = overwrites old content
    mode = "Replace"
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/upload' -Method POST -ContentType 'application/json' -Body $body
```
**Important:** Replace with SAME filename to update. Old chunks auto-deleted.

### Delete - Remove document by filename
```powershell
$body = @{
    name = "filename.txt"
    mode = "Delete"
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/upload' -Method POST -ContentType 'application/json' -Body $body
```
**Response:** `{"status":"Deleted"}`

**Script location:** `D:\test\upload-delete.ps1`

---

## 4. List Documents

```powershell
Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/documents' -Method GET
```

---

## 5. Reset Index (DANGER - deletes ALL)

```powershell
Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/index/reset' -Method DELETE
```
**Response:** `{"status":"Index reset complete"}`

**Warning:** This deletes ALL documents from the index!

---

## Workflow

### Before Any Implementation
1. Query secondbrain for existing context
2. Query for similar past decisions/features
3. Document any constraints or requirements found

### During Implementation
1. Query for relevant past decisions
2. Note any conflicts with existing knowledge

### After Implementation
1. **Add** new document (ingest or upload with mode="Add")
2. Use **Replace** if updating existing doc (same filename)
3. Use **Delete** if doc no longer needed

---

## Response Format (Actual)

```json
{
  "answer": "Synthesized response text",
  "sources": ["file1.md", "file2.md"],
  "aggregatedContext": "**Key Points**\n- Summary of all found docs",
  "debug": { "hitsFound": 14, "documentsAggregated": 5, "reducerUsed": true }
}
```

| Field | Contents | Limitation |
|-------|----------|------------|
| `answer` | LLM synthesized response | May have encoding garbling |
| `sources` | Filenames only | No excerpts, no scores |
| `aggregatedContext` | Summary of all hits | Can't trace to specific doc |
| `debug` | Counts only | No relevance scores |

**Limitation identified:** Sources array shows filenames but not which excerpt matched. Consider parsing `aggregatedContext` to trace claims back to source documents.

### Check project context
```
query: "project-name Supabase architecture edge functions"
mode: conversational
```

### Check security decisions
```
query: "project-name security RLS authentication"
mode: conversational
```

### Check feature history
```
query: "project-name feature implementation history"
mode: conversational
```

### Check database schema
```
query: "project-name database schema tables"
mode: precise
```

---

## File Naming Conventions

| Type | Filename Pattern | Example |
|------|------------------|---------|
| Feature | `{feature-name}.md` | `dynamic-name-personalization.md` |
| Decision | `decision-{description}.md` | `decision-rls-disabled.md` |
| Security | `security-{issue}.md` | `security-rls-fix.md` |
| Bug | `bug-{brief}.md` | `bug-attachment-not-showing.md` |
| Architecture | `architecture-{component}.md` | `architecture-edge-functions.md` |
| SOP | `sop-{procedure}.md` | `sop-deployment.md` |

---

## Example: Documenting a Feature

After implementing `{name}` personalization:

```powershell
$content = @"
# Dynamic Name Personalization Feature

## Date: 2026-04-22
## Project: ms-graph-email-project

## Feature
Added support for {name} placeholder in email content.

## Syntax
- Use {name} in HTML content
- Case insensitive replacement
- Falls back to email prefix if no name

## Files Modified
- src/App.tsx (ComposeTab)
- supabase/functions/send-individual/index.ts
- supabase/functions/process-batches/index.ts
- supabase/functions/process-scheduled-individual/index.ts

## Example
Content: "Hello {name}"
Result: "Hello John"
"@

$body = @{
    content = $content
    filename = "dynamic-name-personalization.md"
    metadata = @{
        doc_type = "feature"
        project = "ms-graph-email-project"
        version = "1.0"
    }
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/ingest' -Method POST -ContentType 'application/json' -Body $body
```

---

## Example: Updating an Existing Document

If the feature changes, REPLACE using same filename:

```powershell
$body = @{
    type = "text"
    content = "UPDATED content here..."
    name = "dynamic-name-personalization.md"
    mode = "Replace"
} | ConvertTo-Json

Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/upload' -Method POST -ContentType 'application/json' -Body $body
```

---

## Keeping D:\test\ Clean

### Option 1: Inline PowerShell (Recommended)
Use one-liners instead of saving PS1 files:

```powershell
# Query
powershell -Command "$body = @{query = 'your query'; mode = 'conversational'} | ConvertTo-Json; Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/query' -Method POST -ContentType 'application/json' -Body $body"

# Ingest
powershell -Command "$body = @{content = 'content'; filename = 'file.md'; metadata = @{doc_type='test'; project='x'; version='1.0'}} | ConvertTo-Json; Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/ingest' -Method POST -ContentType 'application/json' -Body $body"

# Replace
powershell -Command "$body = @{type='text'; content='updated'; name='file.md'; mode='Replace'} | ConvertTo-Json; Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/upload' -Method POST -ContentType 'application/json' -Body $body"

# Delete
powershell -Command "$body = @{name='file.md'; mode='Delete'} | ConvertTo-Json; Invoke-RestMethod -Uri 'https://rag-document-assistant-three.vercel.app/api/upload' -Method POST -ContentType 'application/json' -Body $body"
```

### Option 2: Single Test Script
Keep ONE reusable script: `D:\test\test-secondbrain.ps1`

Delete test pile-up after verification:
```powershell
# After testing, cleanup:
Remove-Item D:\test\test-*.ps1 -Force
```

### Option 3: Never Save Test Files
I should use inline commands via Bash instead of writing PS1 files.

---

## Example Responses

### Query: "Supabase RLS security" (precise mode)
Returns 3-part response: audit findings → remediation → user decision. Sources correctly identify security docs.

### Query: "edge functions deployment" (conversational mode)
Returns actionable deployment steps with code snippets. Sources include feature doc + architecture docs.

### Query: "{name} placeholder personalization" (conversational mode)
Returns simple explanation with example. **Note:** Sources may be too broad for generic queries.

---

## Reminders

- **Query before every decision** - Don't assume, check first
- **Inline commands preferred** - Avoid saving PS1 files that pile up
- **Cleanup after testing** - Delete test files when done
- **Add new, Replace existing, Delete old** - Choose correct mode
- **Same filename = Replace** - Auto-deletes old, inserts new
- **Use descriptive filenames** - Easy to find later
- **Include metadata** - doc_type, project, version help filtering
- **Check existing docs** - Don't duplicate, REPLACE instead
- **Reset Index = DANGER** - Deletes ALL documents!
