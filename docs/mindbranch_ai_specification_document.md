# MindBranch AI: Next-Generation Local-First AI Knowledge Engine & Proactive Buddy

**Document Version:** 1.0.0  
**Status:** Draft / Architectural Blueprint for Engineering & Design Teams  
**Target Platform:** Web Application (PWA) / Desktop (WASM) → Mobile Expansion  

---

## 1. Executive Summary & Vision

Traditional note-taking applications force users into rigid folder hierarchies or unstructured tag clouds. They act as passive storage vaults rather than active learning partners. **MindBranch AI** fundamentally transforms personal knowledge management (PKM) by combining four paradigm-shifting systems into a single, local-first workspace:

1. **Organic Knowledge Graph Engine:** A hybrid structure where top-level life domains (*Academic, Work, Conferences, Projects*) serve as explicit root branches while sub-ideas dynamically cluster into semantic networks.
2. **Multi-Resource Canvas & Uploads Vault:** An infinite canvas per node where users upload raw materials (PDFs, DOCX, Images, OCR text, Scratchpad thoughts) for multi-source sequential processing.
3. **Pedagogical Synthesis Engine:** An intelligent summarization workflow that automatically selects instructional frameworks (*Cornell Notes, Feynman Technique, Socratic Active Recall, Visual Flowcharts*) to convert raw files into structured "Smart Notes."
4. **Proactive Buddy & Deadline Engine:** An embedded agentic buddy that extracts task deadlines from natural language prompts, schedules local calendar alerts, and nudges the user via app side-drawers, desktop widgets, and push notifications.

---

## 2. Core Architectural Principles

* **Local-First & Private:** All graph databases, vector indexes, document embeddings, and notes reside locally on the user's device (IndexedDB / WASM). No private notes are sent to third-party clouds unless explicitly configured.
* **Preserve authentic voice:** The AI serves as an active assistant rather than a ghostwriter—helping users synthesize, question, and structure their own thoughts.
* **Zero-Latency Visual Knowledge:** High-performance graph layouts and instant document parsing guarantee seamless performance during dense research sessions.

---

## 3. Detailed Feature Breakdown

### Module 1: Organic Knowledge Graph & Hybrid Tree Engine
* **Hierarchical Tree Hubs:** Users organize top-level nodes into recognizable lifecycle branches:
  * `Muhaymen / Workspace` $\rightarrow$ `Academic` $\rightarrow$ `Univ Class` $\rightarrow$ `OS: Concurrency`
  * `Muhaymen / Workspace` $\rightarrow$ `Work` $\rightarrow$ `Projects` $\rightarrow$ `Mobile App Architecture`
* **Semantic Graph Overlays:** The system automatically calculates cosine similarity between vector embeddings of different notes across branches, rendering suggested relationship edges.
* **Prompt-Driven Linking:** Users can alter or merge branches using natural language commands (e.g., *"Connect this project note to my Operating Systems lecture under Academic"*).

### Module 2: Multi-Resource Canvas & Uploads Vault
* **Upload Vault:** Drag-and-drop vault accepting PDFs, Word documents, plain text, and images.
* **Sequential Ingestion Pipeline:** When multiple files are attached to a node, the ingestion worker parses them sequentially, extracting text, running OCR on visual diagrams, and establishing cross-file semantic themes.
* **Scratchpad Canvas:** A rich-text area for user draft thoughts, meeting transcripts, or quick lecture logs.

### Module 3: Pedagogical Synthesis Engine
When the user triggers **Generate Smart Note**, the AI evaluates the node's uploaded content and automatically selects or merges pedagogical frameworks:

| Framework | Target Material | Output Generated |
| :--- | :--- | :--- |
| **Cornell Note-Taking** | Dense Lectures, Textbooks | 2-column layout (Left: Cues/Keywords, Right: Main Notes) + Bottom Takeaway Summary. |
| **Feynman Technique** | Technical Concepts, Proofs | "Explain Like I'm 5" (ELI5) analogies, simplified terminology, and gap explanations. |
| **Socratic Active Recall** | Exam Review, Study Materials | Interactive collapsible Q&A cards for self-testing. |
| **Visual Representation** | Workflow Specs, Algorithms | Native Mermaid.js or SVG flowcharts, node trees, and process diagrams. |
| **Source Citations** | Research Papers | Direct internal citations (e.g., `Page 4, Sec 2`) and verified external links. |

### Module 4: Proactive Buddy & Deadline Engine
* **Structured Input Section:** Dedicated task prompt field inside the Deadlines drawer (e.g., *"I need to submit my Physics Lab Report by Friday at 5:00 PM"*).
* **Intent Extraction Engine:** Parses natural language into actionable JSON schema payloads containing task names, timestamps, linked graph nodes, and priority tags.
* **Multi-Surface Nudges:**
  * **In-App Side Drawer:** Interactive chat companion reviewing upcoming weekly milestones.
  * **System Notifications:** Scheduled Web Push and Service Worker alerts.
  * **Desktop Glanceables:** PWA manifest widget integration for OS home screens.

---

## 4. System Architecture & Technical Stack

```
┌────────────────────────────────────────────────────────────────────────┐
│                   FRONTEND LAYER (React / Next.js PWA)                  │
│  ┌─────────────────────────┬───────────────────┬─────────────────────┐ │
│  │ Knowledge Graph Canvas  │  Rich Note Editor │  Proactive Buddy UI │ │
│  │ (3D-Force-Graph/Cytoscape)│ (TipTap / Block) │    (Side-Drawer)     │ │
│  └─────────────────────────┴───────────────────┴─────────────────────┘ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   CLIENT RUNTIME ENGINE (In-Browser WASM)              │
│  ┌──────────────────────────┬──────────────────┬─────────────────────┐ │
│  │ Voy / Transformers.js    │  Kùzu DB WASM    │ Service Worker      │ │
│  │ (Local Embeddings)       │  (Graph Database)│ Notification Engine │ │
│  └──────────────────────────┴──────────────────┴─────────────────────┘ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         LOCAL STORAGE LAYER                            │
│  ┌──────────────────────────┬────────────────────────────────────────┐ │
│  │ IndexedDB (Vector Store) │ IndexedDB / SQLite (Graph & Notes Data)│ │
│  └──────────────────────────┴────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

* **Frontend Framework:** React 18 / Next.js (SSG/PWA) + Tailwind CSS
* **Graph Rendering:** Cytoscape.js or 3D-Force-Graph
* **Editor Engine:** TipTap / BlockNote (Block-based AST parsing)
* **Local Database:** Kùzu DB (WASM) or SQLite (WASM with VFS)
* **Local Embeddings:** Transformers.js / Voy Vector Indexing
* **Background Tasks:** Web Workers + Service Workers for notifications

---

## 5. Data Models & JSON Schemas

### Graph Node Schema
```json
{
  "node_id": "node_os_concurrency_01",
  "title": "Operating Systems: Concurrency & Locks",
  "tree_path": ["Muhaymen", "Academic", "Univ Class"],
  "created_at": "2026-10-08T09:30:00Z",
  "updated_at": "2026-10-08T09:50:00Z",
  "uploads": [
    { "file_id": "f_pdf_01", "name": "OS_Lecture_04.pdf", "type": "pdf", "status": "vectorized" },
    { "file_id": "f_img_01", "name": "Deadlock_Diagram.png", "type": "image", "status": "ocr_completed" }
  ],
  "raw_notes": "Key Takeaways from Professor's Lecture...",
  "relations": [
    { "target_id": "node_chem_02", "relation": "CONCEPT_LINK", "origin": "ai_suggested", "weight": 0.78 }
  ]
}
```

### Smart Note Synthesis Output Schema
```json
{
  "smart_note_id": "sn_os_concurrency_01",
  "node_id": "node_os_concurrency_01",
  "applied_frameworks": ["Cornell", "Feynman", "Visual Diagram", "Socratic Q&A"],
  "cornell": {
    "cues": ["Concurrency", "Mutex Guard", "Deadlock 4-Cond"],
    "main_notes": ["Mutual Exclusion (Mutex) guarantees single thread access...", "Break circular wait..."],
    "summary": "Concurrency controls non-deterministic thread execution..."
  },
  "feynman": {
    "analogy": "Restroom key on a heavy wooden block in a coffee shop...",
    "key_insight": "Deadlock occurs when Customer A holds Key #1 waiting for Key #2 while Customer B holds Key #2..."
  },
  "socratic_questions": [
    { "question": "What are the 4 mandatory conditions for a Deadlock?", "answer": "1. Mutual Exclusion, 2. Hold & Wait, 3. No Preemption, 4. Circular Wait" }
  ],
  "citations": [
    { "source": "OS_Lecture_04.pdf (Page 6)", "type": "internal" },
    { "source": "https://en.wikipedia.org/wiki/Mutual_exclusion", "type": "external" }
  ]
}
```

### Task & Deadline Extraction Schema
```json
{
  "task_id": "task_os_assignment_02",
  "node_id": "node_os_concurrency_01",
  "task_name": "Submit Concurrency Programming Lab",
  "due_timestamp": "2026-10-12T17:00:00Z",
  "priority": "HIGH",
  "status": "PENDING",
  "notifications_scheduled": [
    "2026-10-11T17:00:00Z",
    "2026-10-12T12:00:00Z"
  ]
}
```

---

## 6. User Experience & Workflow Diagrams

### Ingestion, Pedagogical Synthesis & Refinement Workflow
```
[User Uploads PDFs / Docs / Images] ──► [Sequential Text / OCR Extractor]
                                                    │
                                                    ▼
[User Triggers "Generate Smart Note"] ──► [Auto-Framework Selection Engine]
                                                    │
                                                    ├─► [Build Cornell Cues & Notes]
                                                    ├─► [Generate Feynman Analogy]
                                                    ├─► [Construct Visual Diagram]
                                                    └─► [Form Socratic Review Q&A]
                                                    │
                                                    ▼
[Render Smart Note Card] ◄───────► [Iterative Refinement Chat Drawer]
```

### Deadline Processing & Notification Workflow
```
[User Prompt: "Complete OS Lab by Friday 5 PM"]
                        │
                        ▼
            [Intent Extraction Engine]
                        │
                        ▼
          [Generate Task Node & Schema]
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
[Sync to Local Calendar]   [Schedule Service Worker Push]
        │                               │
        ▼                               ▼
[App Side-Drawer Banner]    [System & Desktop Notifications]
```

---

## 7. Development Roadmap & Implementation Plan

### Phase 1: Core Storage & Local Knowledge Graph (Weeks 1–3)
* Set up Next.js PWA project with Tailwind CSS and Lucide UI components.
* Implement local IndexedDB storage and Kùzu DB WASM initialization.
* Build tree navigation sidebar with organic branching (Academic, Work, Conferences, Life).

### Phase 2: Canvas Whiteboard & Multi-Resource Vault (Weeks 4–6)
* Develop the Uploads Vault supporting PDFs, Word documents, text files, and images.
* Implement browser-side text extraction and Web Worker vector embedding pipeline (Voy / Transformers.js).
* Build scratchpad draft notes editor with real-time auto-save.

### Phase 3: Pedagogical Synthesis Engine & Smart Note Cards (Weeks 7–9)
* Construct the multi-framework synthesis pipeline (Cornell, Feynman, Socratic Q&A, Visual Diagram generator).
* Build the Smart Note display drawer with collapsible Socratic flashcard views and SVG diagram rendering.
* Implement the chat-based iterative refinement engine for note modifications.

### Phase 4: Proactive Buddy & Notification Engine (Weeks 10–12)
* Implement natural language deadline extraction parser.
* Integrate Service Worker background push notifications and local calendar ICS exports.
* Build desktop widget PWA support and full offline capabilities testing.