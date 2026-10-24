"use client";

/**
 * 证据关系网络 · 3D 场景
 *
 * 与首页的通天河共用视觉语言，但这里画的是**真实数据**：
 *   主干   = 原始命题
 *   分枝   = 拆解出的子命题
 *   簇节点 = （子命题 × 证据关系）聚合体，一枚叶片代表一组同向证据
 *   叶色   = 证据关系（支持 / 反对 / 背景 / 待核验）
 *   红线   = 同一子命题下「支持簇 ↔ 反对簇」的冲突张力
 *
 * 为什么按簇而不是一条证据一枚叶片：一次调查常有一百多条来源，
 * 逐条画成节点会糊成噪点，主干与分枝结构全部看不见。
 * 聚簇后节点数 = 子命题数 × 关系种类数（通常 8～16 个），
 * 结构清晰，同时每枚叶片仍标注真实条数，不丢信息。
 *
 * 交互：鼠标左键按住左右拖动改变观察视角，松手有惯性衰减。
 * 降级：WebGL 不可用 → 不渲染，交回 CSS 兜底；reduced-motion → 静止但仍可拖动；
 *      窄屏 → 降低像素比与雾浓度。
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { EvidenceRelation } from "@/types/prism";

const VOID = 0x090b10;
const TONE: Record<EvidenceRelation, number> = {
  supports: 0xd8ff75,
  contradicts: 0xff6b6b,
  context: 0x6bb8ff,
  unverified: 0xc9a7ff,
};

export interface EvidenceNode {
  id: string;
  /** 所属子命题 */
  claimId: string | null;
  relation: EvidenceRelation;
  /** 所属子命题在网络中的序号，用于分枝角度分配 */
  branchIndex: number;
  /** 同一子命题内的序号，用于叶片分布 */
  order: number;
}

interface Props {
  nodes: EvidenceNode[];
  className?: string;
}

/** 一个簇：同一子命题下、同一关系的一组证据 */
interface Cluster {
  key: string;
  claimId: string | null;
  branchIndex: number;
  relation: EvidenceRelation;
  count: number;
  /** 簇在所属分枝上的序号 */
  slot: number;
  /** 簇在所属分枝上的总槽位数 */
  slots: number;
}

function buildClusters(nodes: EvidenceNode[]): Cluster[] {
  const groups = new Map<string, EvidenceNode[]>();
  for (const n of nodes) {
    const key = `${n.claimId ?? "root"}::${n.relation}`;
    const arr = groups.get(key);
    if (arr) arr.push(n);
    else groups.set(key, [n]);
  }

  const byClaim = new Map<string, Cluster[]>();
  const out: Cluster[] = [];
  for (const [key, arr] of groups) {
    const first = arr[0];
    const c: Cluster = {
      key,
      claimId: first.claimId,
      branchIndex: first.branchIndex,
      relation: first.relation,
      count: arr.length,
      slot: 0,
      slots: 1,
    };
    out.push(c);
    const ck = first.claimId ?? "root";
    const list = byClaim.get(ck);
    if (list) list.push(c);
    else byClaim.set(ck, [c]);
  }
  byClaim.forEach((list) => {
    list.forEach((c, i) => {
      c.slot = i;
      c.slots = list.length;
    });
  });
  return out;
}

export default function EvidenceNetwork({ nodes, className }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (nodes.length === 0) return;

    const clusters = buildClusters(nodes);

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const small = window.innerWidth < 768;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !small,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "pan-y";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(VOID, 0.032);

    const camera = new THREE.PerspectiveCamera(
      48,
      mount.clientWidth / mount.clientHeight,
      0.1,
      200,
    );
    camera.position.set(0, 0, 30);

    // ---------- 主干：原始命题 ----------
    const trunkCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -12, 0),
      new THREE.Vector3(0.8, -6, 0.6),
      new THREE.Vector3(-0.7, 0, -0.5),
      new THREE.Vector3(0.6, 6, 0.6),
      new THREE.Vector3(0, 12, 0),
    ]);
    const trunk = new THREE.Mesh(
      new THREE.TubeGeometry(trunkCurve, 180, 0.62, 12, false),
      new THREE.MeshStandardMaterial({
        color: 0x18202c,
        emissive: 0x1d3327,
        emissiveIntensity: 0.9,
        roughness: 0.66,
        metalness: 0.36,
      }),
    );
    scene.add(trunk);

    // 主干上的荧光节律点：一眼看出「这是同一棵巨物」
    const beatMat = new THREE.MeshBasicMaterial({ color: 0xd8ff75 });
    for (let i = 0; i <= 7; i += 1) {
      const p = trunkCurve.getPointAt(i / 7);
      const beat = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 12, 12),
        beatMat,
      );
      beat.position.copy(p);
      scene.add(beat);
    }

    // ---------- 分枝与簇节点 ----------
    // 簇数量很少（子命题数 × 关系种类数），用独立 Mesh 而非 InstancedMesh：
    // instanceColor 只影响 diffuse 不影响 emissive，簇会全部显示成白色。
    const leafGeo = new THREE.OctahedronGeometry(0.62, 0);
    const leafMeshes: THREE.Mesh[] = [];
    const leafPos: THREE.Vector3[] = [];
    const leafScale: number[] = [];

    const linkPts: THREE.Vector3[] = [];

    // 子命题 → 分枝锚点
    const claimAnchors = new Map<string, { anchor: THREE.Vector3; t: number }>();
    const claimIds = Array.from(
      new Set(clusters.map((c) => c.claimId ?? "root")),
    );
    claimIds.forEach((cid, i) => {
      // 沿主干纵向均匀铺开
      const t = 0.12 + (i / Math.max(1, claimIds.length - 1)) * 0.76;
      const anchor = trunkCurve.getPointAt(t);
      claimAnchors.set(cid, { anchor, t });
    });

    clusters.forEach((c, i) => {
      const cid = c.claimId ?? "root";
      const a = claimAnchors.get(cid)!;
      // 分枝向左右交替展开：angle 带符号，sin(angle) 自然决定左右
      const side = c.branchIndex % 2 === 0 ? 1 : -1;
      const angle = side * (0.55 + ((i * 37) % 5) * 0.17);
      const reach = 6.2 + ((i * 29) % 4) * 1.1;
      const rise = ((i * 53) % 7) * 0.42 - 1.2;
      const end = a.anchor
        .clone()
        .add(
          new THREE.Vector3(
            Math.sin(angle) * reach,
            rise + c.slot * 0.9,
            Math.cos(angle) * reach * 0.55,
          ),
        );
      const mid = a.anchor
        .clone()
        .add(
          new THREE.Vector3(
            Math.sin(angle) * reach * 0.45,
            0.9,
            Math.cos(angle) * reach * 0.3,
          ),
        );

      const curve = new THREE.QuadraticBezierCurve3(a.anchor, mid, end);
      const branch = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 30, 0.085, 6, false),
        new THREE.MeshStandardMaterial({
          color: 0x141b26,
          emissive: 0x1e3026,
          emissiveIntensity: 0.75,
          roughness: 0.64,
          metalness: 0.42,
        }),
      );
      scene.add(branch);
      linkPts.push(a.anchor.clone(), end.clone());

      const tone = TONE[c.relation];
      const leaf = new THREE.Mesh(
        leafGeo,
        new THREE.MeshStandardMaterial({
          color: 0x0d141c,
          emissive: tone,
          emissiveIntensity: 1.5,
          roughness: 0.28,
          metalness: 0.5,
        }),
      );
      leaf.position.copy(end);
      scene.add(leaf);
      leafMeshes.push(leaf);
      leafPos.push(end.clone());
      // 叶片大小随证据条数缓慢增长，但设上限，避免大簇压过结构
      leafScale.push(Math.min(1.7, 0.8 + Math.log2(c.count + 1) * 0.3));
    });

    // 冲突连线：同一子命题下，支持簇 ↔ 反对簇
    const conflictPts: THREE.Vector3[] = [];
    claimIds.forEach((cid) => {
      const inClaim = clusters.filter((c) => (c.claimId ?? "root") === cid);
      const sup = inClaim.filter((c) => c.relation === "supports");
      const con = inClaim.filter((c) => c.relation === "contradicts");
      sup.forEach((s) => {
        con.forEach((x) => {
          const si = clusters.indexOf(s);
          const xi = clusters.indexOf(x);
          conflictPts.push(leafPos[si].clone(), leafPos[xi].clone());
        });
      });
    });
    if (conflictPts.length > 0) {
      scene.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(conflictPts),
          new THREE.LineBasicMaterial({
            color: 0xff6b6b,
            transparent: true,
            opacity: 0.55,
          }),
        ),
      );
    }

    // 簇之间（同子命题内）的连线
    const relationPts: THREE.Vector3[] = [];
    claimIds.forEach((cid) => {
      const inClaim = clusters.filter((c) => (c.claimId ?? "root") === cid);
      for (let a = 0; a + 1 < inClaim.length; a += 1) {
        const ia = clusters.indexOf(inClaim[a]);
        const ib = clusters.indexOf(inClaim[a + 1]);
        relationPts.push(leafPos[ia].clone(), leafPos[ib].clone());
      }
    });
    if (relationPts.length > 0) {
      scene.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(relationPts),
          new THREE.LineBasicMaterial({
            color: 0xd8ff75,
            transparent: true,
            opacity: 0.22,
          }),
        ),
      );
    }

    // 骨架连线（主干 ↔ 簇）
    scene.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(linkPts),
        new THREE.LineBasicMaterial({
          color: 0xd8ff75,
          transparent: true,
          opacity: 0.3,
        }),
      ),
    );

    // ---------- 光 ----------
    scene.add(new THREE.AmbientLight(0x2a3340, 1.05));
    const key = new THREE.PointLight(0xd8ff75, 70, 90);
    key.position.set(6, 4, 16);
    scene.add(key);
    const rim = new THREE.PointLight(0x6bb8ff, 50, 90);
    rim.position.set(-11, -7, -8);
    scene.add(rim);

    // ---------- 拖拽视角 ----------
    let yaw = 0;
    let pitch = 0;
    let targetYaw = 0;
    let targetPitch = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let velYaw = 0;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      targetYaw += dx * 0.0055;
      targetPitch = Math.max(-0.45, Math.min(0.45, targetPitch + dy * 0.0022));
      velYaw = dx * 0.0055;
    };
    const onUp = () => {
      dragging = false;
      renderer.domElement.style.cursor = "grab";
    };

    renderer.domElement.style.cursor = "grab";
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    // ---------- 循环 ----------
    const timer = new THREE.Timer();
    let raf = 0;
    let visible = true;
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVisibility);

    const render = () => {
      timer.update();
      const t = timer.getElapsed();

      if (!dragging) {
        targetYaw += velYaw;
        velYaw *= 0.92;
        if (Math.abs(velYaw) < 0.00002) velYaw = 0;
        if (!reduceMotion) targetYaw += 0.00035;
      }
      yaw += (targetYaw - yaw) * 0.08;
      pitch += (targetPitch - pitch) * 0.08;

      const r = 30;
      camera.position.set(
        Math.sin(yaw) * r,
        pitch * 12 + (reduceMotion ? 0 : Math.sin(t * 0.14) * 0.5),
        Math.cos(yaw) * r,
      );
      camera.lookAt(0, pitch * 2.5, 0);

      for (let i = 0; i < leafMeshes.length; i += 1) {
        const leaf = leafMeshes[i];
        const p = leafPos[i];
        const sway = reduceMotion ? 0 : Math.sin(t * 0.85 + i * 1.3) * 0.16;
        leaf.position.set(p.x, p.y + sway, p.z);
        leaf.rotation.set(t * 0.24 + i, t * 0.19 + i * 0.7, 0);
        const s =
          leafScale[i] * (reduceMotion ? 1 : 1 + Math.sin(t * 1.4 + i) * 0.06);
        leaf.scale.setScalar(s);
      }

      if (visible) renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    const onResize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [nodes]);

  return (
    <div
      ref={mountRef}
      className={className}
      aria-label="证据关系网络三维视图"
      role="img"
    />
  );
}
