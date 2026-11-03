### Permission-Aware RAG (Retrieval-Augmented Generation) Service

### Enterprise-Grade Secure Knowledge Base System

### 1. Executive Summary & Problem Statement

In enterprise environments, data privacy and access governance are paramount. Standard Retrieval-Augmented Generation (RAG) architectures present a massive security risk: they flatten document structures, making confidential material (e.g., HR files, executive salaries, legal strategy) searchable by unauthorized users. 

This project implements a **Permission-Aware RAG Service** using a full-stack monorepo architecture (**Next.js + FastAPI + LangChain**). Data security rules (Access Control Lists) are strictly enforced directly at the **vector database layer during the retrieval phase**, completely eliminating prompt injection bypass vulnerabilities. The system features an **AI Engineer Inspector View** to visualize execution pipelines and automated validation via the **RAGAS framework**. 

### 2. System Architecture & Technical Stack

The system is built as a split-stack monorepo separating high-performance Python data computing from the client streaming runtime interface. 

### Tech Stack Breakdown

* **Frontend:** Next.js (React 19), TypeScript, Tailwind CSS, Lucide Icons.
* **Backend API & Orchestration:** FastAPI, LangChain, Pydantic v2, PyJWT.
* **Database & Retrieval:** Qdrant (Vector Engine), BM25 (Sparse Keyword Engine).
* **Package Management:** uv (Fast speed Python environment isolation).
* **Evaluation Framework:** RAGAS (Retrieval Augmented Generation Assessment) & Pytest.

### Data Flow Diagram

text

[ Next.js UI Dashboard ] 
           │
           │ (Streams Prompt Request + JWT Identity Header)
           ▼
[ FastAPI App Gateway ]
           │
           ├─► [ Security Middleware ] ──► Parses & Validates User Role/Clearance Tier
           │
           ├─► [ LangChain Engine ] ────► Computes Embedding Vector
           │
           └─► [ Qdrant Vector DB ] ────► Injects Metadata Match Filter (Strict DB-level ACL)
                                          (Ensures zero unauthorized chunk extraction)

Use code with caution.

### 3. Core Features & Functionality

### 1. Zero-Leak DB-Level Retrieval Filtering

* **At Ingestion:** Documents are parsed into semantic chunks using LangChain text splitters. Every chunk is stored in Qdrant with an explicit Access Control List (ACL) attached to its metadata payload (e.g., {"min_clearance": 3, "allowed_roles": ["HR_Manager"]}).
* **At Query:** When a user queries the network, their authenticated role payload is extracted. FastAPI injects a strict models.Filter match directly into the vector database query. The vector database *never* returns records above the user's privilege layer.

### 2. Advanced Hybrid Search & Re-Ranking

* Captures context using **Dense Embeddings** while ensuring exact legal and alpha-numeric tracking via **Sparse BM25 Keyword Search**.
* Retained candidates pass through an isolated Cross-Encoder Re-ranker model, positioning the highest contextual fragments at the front to lower token usage costs and minimize hallucination behaviors.

### 3. Automated Performance Evaluation System

* Integrates a dedicated test utility driven by the **RAGAS** tool suite to generate systemic accuracy audits.
* Evaluates the engine across isolated target metrics: **Context Recall** (Retrieval completeness), **Context Precision** (Retrieval signal noise), **Faithfulness** (Hallucination tracking), and **Answer Relevance**.

### 4. UI/UX Design System

The dashboard layout utilizes a dark-themed, high-density **Two-Column Engineering Control Center** designed to make underlying engineering actions highly transparent to technical reviewers. 

### Left Column: The User Interface Simulator

* **Identity Session Simulator:** A control panel widget with a dropdown interface allowing immediate role switching (Intern - Level 1, Regular Employee - Level 2, HR Manager - Level 3).
* **Interactive Chat Workspace:** Displays distinct state styles for successful data generation and access restriction exceptions (Access Denied warnings highlight tier enforcement).

### Right Column: The AI Engineer Inspector View

* **Active Authentication Payload (JWT):** A live JSON view displaying active claims, IDs, and cryptographic clearance boundaries.
* **Database Filter Injection Monitor:** Renders the literal Python/Qdrant operational filters being applied by FastAPI in real-time.
* **Vector Document Chunk Inspector:** Lists raw string contents and scores returned from the storage indexes. If access is unauthorized, this area updates with an explicit empty state to show that blocking happened at the database level.

### 5. Security & Validation Strategy

Security coverage is maintained via automated integration suites inside the backend workflow: 

* **Segregation Testing:** Automated scripts execute targeted prompts using unprivileged profiles against confidential sections to assert that the database output yields an empty list result.
* **Deterministic Baseline Guarding:** Pytest tracking sets threshold criteria for RAGAS evaluation scores to block builds showing sub-optimal context extraction behavior.