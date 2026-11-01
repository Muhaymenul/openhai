"use client";

import type {
  ResearchGraph as GraphData,
  GraphEdge,
  GraphNode,
  SourceRef,
} from "@/lib/research/types";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Download,
  Focus,
  GitBranch,
  Maximize2,
  Minus,
  Network,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { errorText, postJson } from "./api";
import { SourceChips } from "./ResearchUi";
import { filterGraph, nodeKindLabel } from "./graph/graph-data";
import { useGraphCanvas } from "./graph/use-graph-canvas";
import styles from "./graph/graph.module.css";

type Selection = { kind: "node" | "edge"; id: string } | null;

export function ResearchGraph({
  graph,
  onRefresh,
  onOpenSource,
  notify,
}: {
  graph: GraphData;
  onRefresh(): Promise<void>;
  onOpenSource(source: SourceRef): void;
  notify(message: string, error?: boolean): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const [view, setView] = useState<"all" | "papers">("all");
  const [paperId, setPaperId] = useState("");
  const [query, setQuery] = useState("");
  const [showCandidates, setShowCandidates] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [list, setList] = useState<"nodes" | "candidates">("nodes");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const visible = useMemo(
    () =>
      filterGraph(graph, { view, paperId, query, showCandidates, focusNodeId }),
    [graph, view, paperId, query, showCandidates, focusNodeId],
  );
  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const paperOptions = useMemo(
    () =>
      graph.nodes
        .filter((node) => node.kind === "paper" && node.paperId)
        .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
    [graph.nodes],
  );
  const degrees = useMemo(() => {
    const values = new Map<string, number>();
    visible.edges.forEach((edge) => {
      values.set(edge.source, (values.get(edge.source) ?? 0) + 1);
      values.set(edge.target, (values.get(edge.target) ?? 0) + 1);
    });
    return values;
  }, [visible.edges]);
  const listedNodes = useMemo(() => {
    const matches = new Set(visible.matchedIds);
    const order = { paper: 0, concept: 1, note: 2 };
    return visible.nodes
      .filter((node) => !query.trim() || matches.has(node.id))
      .sort(
        (a, b) =>
          order[a.kind] - order[b.kind] ||
          (degrees.get(b.id) ?? 0) - (degrees.get(a.id) ?? 0) ||
          a.label.localeCompare(b.label, "zh-CN"),
      );
  }, [visible, query, degrees]);
  const candidates = useMemo(
    () => visible.edges.filter((edge) => edge.status === "candidate"),
    [visible.edges],
  );
  const selectedNode =
    selection?.kind === "node"
      ? visible.nodes.find((node) => node.id === selection.id)
      : undefined;
  const selectedEdge =
    selection?.kind === "edge"
      ? visible.edges.find((edge) => edge.id === selection.id)
      : undefined;
  const select = useCallback(
    (kind: "node" | "edge" | null, id: string | null) => {
      setSelection(kind && id ? { kind, id } : null);
    },
    [],
  );
  const canvas = useGraphCanvas({
    container,
    graph,
    visible,
    selectedId: selectedNode?.id ?? selectedEdge?.id ?? null,
    onSelect: select,
  });

  function resetScope() {
    setSelection(null);
    setFocusNodeId(null);
  }

  async function updateEdge(edge: GraphEdge, action: "confirm" | "reject") {
    setSaving(true);
    try {
      await postJson("/graph", {
        action,
        edgeId: edge.id,
        version: edge.version,
      });
      await onRefresh();
      if (action === "reject") setSelection(null);
      notify(
        action === "confirm" ? "这条关系已确认。" : "已拒绝这条候选关系。",
      );
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setSaving(false);
    }
  }

  async function suggest() {
    setGenerating(true);
    try {
      await postJson("/graph", { action: "suggest" });
      await onRefresh();
      notify("关系候选已更新。");
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setGenerating(false);
    }
  }

  function exportGraph(image = false) {
    if (exportMenu.current) exportMenu.current.open = false;
    const anchor = document.createElement("a");
    if (image && canvas.cyRef.current) {
      anchor.href = canvas.cyRef.current.png({
        full: true,
        bg: "#fafbfc",
        scale: 2,
      });
      anchor.download = "教研阅记-知识图谱.png";
    } else {
      anchor.href = URL.createObjectURL(
        new Blob([JSON.stringify(graph, null, 2)], {
          type: "application/json",
        }),
      );
      anchor.download = "教研阅记-知识图谱.json";
    }
    anchor.click();
    if (!image) setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
  }

  function nodeMark(node: GraphNode) {
    return <i aria-hidden="true" className={styles[node.kind]} />;
  }

  function relationshipRow(edge: GraphEdge, fromNode?: string) {
    const otherId = edge.source === fromNode ? edge.target : edge.source;
    return (
      <button
        key={edge.id}
        className={styles.relationRow}
        onClick={() => select("edge", edge.id)}
      >
        <span className={styles.relationLabel}>
          {edge.status === "candidate" && <i className={styles.candidateDot} />}
          {edge.label}
          <ArrowUpRight size={13} />
        </span>
        <span className={styles.relationNames}>
          {fromNode ? (
            nodesById.get(otherId)?.label
          ) : (
            <>
              {nodesById.get(edge.source)?.label}
              <ArrowRight size={12} />
              {nodesById.get(edge.target)?.label}
            </>
          )}
        </span>
      </button>
    );
  }

  return (
    <section className={styles.page} aria-label="知识图谱工作区">
      <header className={styles.heading}>
        <h1>知识图谱</h1>
        <div className={styles.actions}>
          <select
            className={styles.paperFilter}
            aria-label="筛选图谱论文"
            value={paperId}
            title={
              paperOptions.find((paper) => paper.paperId === paperId)?.label ??
              "全部论文"
            }
            onChange={(event) => {
              setPaperId(event.target.value);
              resetScope();
            }}
          >
            <option value="">全部论文</option>
            {paperOptions.map((paper) => (
              <option key={paper.id} value={paper.paperId}>
                {paper.label}
              </option>
            ))}
          </select>
          <details ref={exportMenu} className={styles.exportMenu}>
            <summary>
              <Download size={15} />
              导出
              <ChevronDown size={12} />
            </summary>
            <div>
              <button
                onClick={() => exportGraph(true)}
                disabled={!canvas.ready || !visible.nodes.length}
              >
                当前图谱 PNG
              </button>
              <button onClick={() => exportGraph()}>完整数据 JSON</button>
            </div>
          </details>
          <button
            className={styles.primary}
            disabled={generating}
            onClick={() => void suggest()}
          >
            <Sparkles size={15} />
            {generating ? "整理中…" : "整理关系"}
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        <div className={styles.toolbar}>
          <div className={styles.tabs} role="group" aria-label="图谱视图">
            <button
              aria-pressed={view === "all"}
              onClick={() => {
                setView("all");
                resetScope();
              }}
            >
              研究网络
            </button>
            <button
              aria-pressed={view === "papers"}
              onClick={() => {
                setView("papers");
                resetScope();
              }}
            >
              论文关系
            </button>
          </div>
          <div className={styles.search}>
            <Search size={15} />
            <input
              aria-label="搜索图谱节点"
              placeholder="查找论文、概念、笔记"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                resetScope();
              }}
            />
            {query && (
              <button
                aria-label="清空图谱搜索"
                onClick={() => {
                  setQuery("");
                  resetScope();
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <label className={styles.candidateToggle}>
            <input
              type="checkbox"
              checked={showCandidates}
              onChange={(event) => {
                setShowCandidates(event.target.checked);
                resetScope();
              }}
            />
            候选关系
          </label>
        </div>

        <div className={styles.body}>
          <div className={styles.canvas}>
            {focusNodeId && (
              <div className={styles.focusBar}>
                <button
                  onClick={() => {
                    setFocusNodeId(null);
                    setSelection(null);
                  }}
                >
                  <ArrowLeft size={14} />
                  返回全图
                </button>
                <span>{nodesById.get(focusNodeId)?.label}</span>
              </div>
            )}
            <div
              ref={container}
              className={styles.surface}
              tabIndex={0}
              role="region"
              aria-label="可交互知识图谱"
              aria-describedby="graph-keyboard-help"
              aria-busy={!canvas.ready}
            />
            <span id="graph-keyboard-help" className={styles.srOnly}>
              拖动节点调整位置，滚轮缩放。加减键缩放，0
              适应画布。也可在节点列表中选择。
            </span>
            {(!canvas.ready || canvas.error || !visible.nodes.length) && (
              <div className={styles.empty} role="status">
                <Network size={28} />
                <strong>
                  {canvas.error
                    ? "图谱暂时无法显示"
                    : !canvas.ready
                      ? "正在排列研究网络…"
                      : "没有匹配的节点"}
                </strong>
                <p>
                  {canvas.error ||
                    (canvas.ready ? "试试其他关键词或筛选条件。" : "")}
                </p>
                {canvas.ready && !canvas.error && (
                  <button
                    onClick={() => {
                      setQuery("");
                      setPaperId("");
                      setView("all");
                      setShowCandidates(true);
                      resetScope();
                    }}
                  >
                    重置筛选
                  </button>
                )}
              </div>
            )}
            <div className={styles.canvasControls} aria-label="图谱画布操作">
              <button
                title="缩小图谱"
                aria-label="缩小图谱"
                onClick={() => canvas.zoomBy(1 / 1.2)}
                disabled={!canvas.ready}
              >
                <Minus size={16} />
              </button>
              <span aria-label="图谱缩放比例">{canvas.zoom}%</span>
              <button
                title="放大图谱"
                aria-label="放大图谱"
                onClick={() => canvas.zoomBy(1.2)}
                disabled={!canvas.ready}
              >
                <Plus size={16} />
              </button>
              <span className={styles.divider} />
              <button
                title="适应画布 (0)"
                aria-label="适应画布"
                onClick={canvas.fit}
                disabled={!canvas.ready}
              >
                <Maximize2 size={16} />
              </button>
              <button
                title="重新布局"
                aria-label="重新布局"
                onClick={canvas.relayout}
                disabled={!canvas.ready}
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>

          <aside className={styles.inspector} aria-label="图谱详情">
            <header className={styles.inspectorHeader}>
              {selectedNode || selectedEdge ? (
                <button
                  className={styles.back}
                  onClick={() => select(null, null)}
                >
                  <ArrowLeft size={14} />
                  {selectedEdge ? "关系与证据" : "节点详情"}
                </button>
              ) : (
                <div
                  className={styles.inspectorTabs}
                  role="group"
                  aria-label="图谱浏览列表"
                >
                  <button
                    aria-pressed={list === "nodes"}
                    onClick={() => setList("nodes")}
                  >
                    {query.trim() ? "搜索结果" : "节点"}
                    <span>{listedNodes.length}</span>
                  </button>
                  <button
                    aria-pressed={list === "candidates"}
                    onClick={() => setList("candidates")}
                  >
                    待核对<span>{candidates.length}</span>
                  </button>
                </div>
              )}
              {(selectedNode || selectedEdge) && (
                <button
                  className={styles.close}
                  aria-label="关闭图谱详情"
                  onClick={() => select(null, null)}
                >
                  <X size={15} />
                </button>
              )}
            </header>

            <div className={styles.inspectorBody}>
              {selectedEdge ? (
                <div className={styles.detail}>
                  <div className={styles.detailMeta}>
                    <GitBranch size={14} />
                    <span>
                      {selectedEdge.status === "candidate"
                        ? "候选关系"
                        : "已确认"}
                    </span>
                    <span>
                      {selectedEdge.origin === "ai"
                        ? "AI 整理"
                        : selectedEdge.origin === "user"
                          ? "人工建立"
                          : "资料关联"}
                    </span>
                  </div>
                  <div className={styles.relationFlow}>
                    {[selectedEdge.source, selectedEdge.target].map(
                      (id, index) => (
                        <div key={id}>
                          {index === 1 && (
                            <span className={styles.flowLabel}>
                              ↓ {selectedEdge.label}
                            </span>
                          )}
                          <button onClick={() => select("node", id)}>
                            {nodesById.get(id) && nodeMark(nodesById.get(id)!)}
                            <span>{nodesById.get(id)?.label ?? id}</span>
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                  {selectedEdge.rationale && <p>{selectedEdge.rationale}</p>}
                  {selectedEdge.stale && (
                    <p className={styles.notice}>原文已更新，请重新核对。</p>
                  )}
                  <h3>
                    原文证据 <span>{selectedEdge.evidence.length}</span>
                  </h3>
                  {selectedEdge.evidence.map((source, index) => (
                    <div className={styles.evidence} key={index}>
                      {source.quote && <blockquote>{source.quote}</blockquote>}
                      <SourceChips sources={[source]} onOpen={onOpenSource} />
                    </div>
                  ))}
                  {!selectedEdge.evidence.length && (
                    <p className={styles.muted}>暂无原文摘录。</p>
                  )}
                  {selectedEdge.status === "candidate" && (
                    <div className={styles.detailActions}>
                      <button
                        className={styles.primary}
                        disabled={saving}
                        onClick={() => void updateEdge(selectedEdge, "confirm")}
                      >
                        <Check size={14} />
                        确认关系
                      </button>
                      <button
                        className={styles.secondary}
                        disabled={saving}
                        onClick={() => void updateEdge(selectedEdge, "reject")}
                      >
                        <X size={14} />
                        拒绝
                      </button>
                    </div>
                  )}
                </div>
              ) : selectedNode ? (
                <div className={styles.detail}>
                  <div className={styles.detailMeta}>
                    {nodeMark(selectedNode)}
                    {nodeKindLabel(selectedNode.kind)}
                    <span>{degrees.get(selectedNode.id) ?? 0} 条关系</span>
                  </div>
                  <h2>{selectedNode.label}</h2>
                  {selectedNode.definition && <p>{selectedNode.definition}</p>}
                  <div className={styles.detailActions}>
                    {(selectedNode.paperId || selectedNode.noteId) && (
                      <button
                        className={styles.secondary}
                        onClick={() =>
                          onOpenSource({
                            paperId: selectedNode.paperId,
                            noteId: selectedNode.noteId,
                          })
                        }
                      >
                        <BookOpen size={14} />
                        {selectedNode.kind === "note" ? "打开笔记" : "打开论文"}
                      </button>
                    )}
                    <button
                      className={styles.secondary}
                      aria-pressed={focusNodeId === selectedNode.id}
                      onClick={() =>
                        setFocusNodeId(
                          focusNodeId === selectedNode.id
                            ? null
                            : selectedNode.id,
                        )
                      }
                    >
                      <Focus size={14} />
                      {focusNodeId === selectedNode.id
                        ? "显示全图"
                        : "只看相邻"}
                    </button>
                  </div>
                  <h3>相连的关系</h3>
                  {visible.edges
                    .filter(
                      (edge) =>
                        edge.source === selectedNode.id ||
                        edge.target === selectedNode.id,
                    )
                    .map((edge) => relationshipRow(edge, selectedNode.id))}
                  {!degrees.get(selectedNode.id) && (
                    <p className={styles.muted}>暂无相连关系。</p>
                  )}
                </div>
              ) : list === "nodes" ? (
                <div className={styles.nodeList}>
                  {listedNodes.map((node) => (
                    <button
                      className={styles.nodeRow}
                      key={node.id}
                      onClick={() => select("node", node.id)}
                    >
                      {nodeMark(node)}
                      <span>
                        <strong>{node.label}</strong>
                        <small>{nodeKindLabel(node.kind)}</small>
                      </span>
                      <span className={styles.degree} title="相连关系数">
                        {degrees.get(node.id) ?? 0}
                      </span>
                    </button>
                  ))}
                  {!listedNodes.length && (
                    <p className={styles.listEmpty}>没有匹配的节点。</p>
                  )}
                </div>
              ) : (
                <div className={styles.candidateList}>
                  {candidates.map((edge) => relationshipRow(edge))}
                  {!candidates.length && (
                    <p className={styles.listEmpty}>
                      {showCandidates
                        ? "当前范围没有待核对关系。"
                        : "开启“候选关系”后查看。"}
                    </p>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>

        <footer className={styles.footer}>
          <div className={styles.legend} aria-label="图谱图例">
            <span>
              <i className={styles.paper} />
              论文
            </span>
            <span>
              <i className={styles.concept} />
              概念
            </span>
            <span>
              <i className={styles.note} />
              笔记
            </span>
            <span className={styles.candidateKey}>
              <i />
              候选
            </span>
          </div>
          <span role="status">
            {visible.nodes.length} 个节点 · {visible.edges.length} 条关系
          </span>
        </footer>
      </div>
    </section>
  );
}
