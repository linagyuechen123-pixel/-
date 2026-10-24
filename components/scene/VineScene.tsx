"use client";

/**
 * 通天藤蔓 · 3D 场景
 *
 * 程序化生成，不依赖任何外部模型或贴图：
 *  - 主干：一条贯穿视野的巨藤，向上高不见顶、向下深不见底，两端没入云雾
 *  - 分支：从主干分出并向外弯曲，末端挂一枚发光叶片
 *  - 叶片 + 连线：构成证据关系网络，叶片数量随证据条数变化
 *  - 交互：鼠标左键按住左右拖动改变视角，带惯性衰减；不拖动时极缓慢漂移
 *
 * 降级策略（都要保留，不能只在高端设备上好看）：
 *  - WebGL 不可用 → 不渲染 3D，交回 CSS 渐变兜底
 *  - prefers-reduced-motion → 静止渲染，仍可拖动，不做自动漂移与叶片摆动
 *  - 窄屏 / 低内存 → 降低分支数与像素比
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

interface VineSceneProps {
  className?: string;
  /** 叶片（证据节点）数量，决定分支密度 */
  nodeCount?: number;
  /** 是否响应拖拽；背景用途可关闭以免与内容交互冲突 */
  interactive?: boolean;
}

const VOID = 0x090b10;
const ACCENT = 0xd8ff75;
const COOL = 0x6bb8ff;

export default function VineScene({
  className,
  nodeCount = 26,
  interactive = true,
}: VineSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const small = window.innerWidth < 768;
    const branches = Math.max(
      10,
      Math.min(small ? 16 : 34, nodeCount > 0 ? nodeCount : 26),
    );

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !small,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      // WebGL 不可用：保留 mount 上的 CSS 兜底背景，不做任何 3D 渲染
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "pan-y";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(VOID, small ? 0.022 : 0.016);

    const camera = new THREE.PerspectiveCamera(
      52,
      mount.clientWidth / mount.clientHeight,
      0.1,
      300,
    );
    camera.position.set(0, 0, 30);

    // ---------- 主干 ----------
    const trunkPoints: THREE.Vector3[] = [];
    const SEG = 120;
    for (let i = 0; i <= SEG; i += 1) {
      const t = i / SEG;
      const y = -52 + t * 116;
      const x = Math.sin(t * 5.2) * 3.4 + Math.sin(t * 1.7) * 1.4;
      const z = Math.cos(t * 4.1) * 2.8 + Math.cos(t * 0.9) * 1.7;
      trunkPoints.push(new THREE.Vector3(x, y, z));
    }
    const trunkCurve = new THREE.CatmullRomCurve3(trunkPoints);
    // 主干要够粗，才有「巨物」的体量感
    const trunkGeo = new THREE.TubeGeometry(trunkCurve, 240, 1.55, 14, false);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x1a2230,
      emissive: 0x16281f,
      emissiveIntensity: 1.05,
      roughness: 0.66,
      metalness: 0.38,
    });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    scene.add(trunk);

    // 主干内侧的荧光脉络：像血管一样透出光
    const coreGeo = new THREE.TubeGeometry(trunkCurve, 200, 0.32, 8, false);
    const core = new THREE.Mesh(
      coreGeo,
      new THREE.MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0.24,
      }),
    );
    scene.add(core);

    // 主干上的纵向纹路：一圈细线，让巨物有尺度感
    const ridgeMat = new THREE.LineBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.2,
    });
    for (let r = 0; r < 5; r += 1) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 160; i += 1) {
        const t = i / 160;
        const p = trunkCurve.getPointAt(t);
        const tan = trunkCurve.getTangentAt(t);
        const side = new THREE.Vector3(0, 1, 0).cross(tan).normalize();
        const angle = (r / 5) * Math.PI * 2;
        const off = side
          .clone()
          .applyAxisAngle(tan, angle)
          .multiplyScalar(1.57);
        pts.push(p.clone().add(off));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      scene.add(new THREE.Line(g, ridgeMat));
    }

    // ---------- 分支 + 叶片 ----------
    const branchGroup = new THREE.Group();
    scene.add(branchGroup);

    // 叶片分暖/冷两组实例网格：instanceColor 只影响 diffuse 不影响 emissive，
    // 混在一组里所有叶子都会显示成同一个颜色。
    const leafGeo = new THREE.OctahedronGeometry(0.34, 0);
    const makeLeafMat = (emissive: number) =>
      new THREE.MeshStandardMaterial({
        color: 0x0f1720,
        emissive,
        emissiveIntensity: 1.5,
        roughness: 0.32,
        metalness: 0.58,
      });
    const warmLeaves = new THREE.InstancedMesh(
      leafGeo,
      makeLeafMat(ACCENT),
      branches * 2,
    );
    const coolLeaves = new THREE.InstancedMesh(
      leafGeo,
      makeLeafMat(COOL),
      branches * 2,
    );
    warmLeaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    coolLeaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    branchGroup.add(warmLeaves, coolLeaves);

    const leafData: {
      base: THREE.Vector3;
      phase: number;
      scale: number;
      warm: boolean;
    }[] = [];
    const linkPts: THREE.Vector3[] = [];

    const tmpObj = new THREE.Object3D();

    for (let i = 0; i < branches; i += 1) {
      const t = 0.06 + (i / branches) * 0.88 + Math.random() * 0.02;
      const anchor = trunkCurve.getPointAt(Math.min(0.98, t));
      const tangent = trunkCurve.getTangentAt(Math.min(0.98, t));
      const side = new THREE.Vector3(0, 1, 0)
        .cross(tangent)
        .normalize()
        .applyAxisAngle(tangent, Math.random() * Math.PI * 2);

      const reach = 7.5 + Math.random() * 11;
      const end = anchor
        .clone()
        .add(side.clone().multiplyScalar(reach))
        .add(new THREE.Vector3(0, (Math.random() - 0.5) * 6.5, 0));
      const mid = anchor
        .clone()
        .add(side.clone().multiplyScalar(reach * 0.45))
        .add(new THREE.Vector3(0, 1.6 + Math.random() * 2.2, 0));

      const curve = new THREE.QuadraticBezierCurve3(anchor, mid, end);
      const bg = new THREE.TubeGeometry(
        curve,
        30,
        0.16 + Math.random() * 0.14,
        7,
        false,
      );
      const bmat = new THREE.MeshStandardMaterial({
        color: 0x151d28,
        emissive: 0x24382c,
        emissiveIntensity: 0.95,
        roughness: 0.62,
        metalness: 0.42,
      });
      branchGroup.add(new THREE.Mesh(bg, bmat));

      // 每根分支末端挂两枚叶（一主一次），构成关系网络的节点
      for (let k = 0; k < 2; k += 1) {
        const p = end
          .clone()
          .add(
            new THREE.Vector3(
              (Math.random() - 0.5) * 2.4,
              (Math.random() - 0.5) * 2.4,
              (Math.random() - 0.5) * 2.4,
            ),
          );
        const warm = k === 0 ? Math.random() > 0.35 : Math.random() > 0.82;
        leafData.push({
          base: p,
          phase: Math.random() * Math.PI * 2,
          scale: k === 0 ? 1 : 0.55 + Math.random() * 0.35,
          warm,
        });
        // 叶片 → 所属分支末端 → 主干，形成可追溯的连线
        linkPts.push(p.clone(), end.clone());
      }
      linkPts.push(end.clone(), anchor.clone());
    }

    // 近邻叶片之间连线：关系网络的横向边
    for (let i = 0; i < leafData.length; i += 1) {
      for (let j = i + 1; j < leafData.length; j += 1) {
        if (leafData[i].base.distanceTo(leafData[j].base) < 4.6) {
          linkPts.push(leafData[i].base.clone(), leafData[j].base.clone());
        }
      }
    }

    const linkGeo = new THREE.BufferGeometry().setFromPoints(linkPts);
    const linkMat = new THREE.LineBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.24,
    });
    branchGroup.add(new THREE.LineSegments(linkGeo, linkMat));

    // ---------- 上下云雾 ----------
    const mistTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 126);
      g.addColorStop(0, "rgba(180,220,255,0.55)");
      g.addColorStop(0.45, "rgba(120,170,220,0.22)");
      g.addColorStop(1, "rgba(9,11,16,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(c);
    })();

    const mists: THREE.Sprite[] = [];
    if (mistTex) {
      for (let i = 0; i < 6; i += 1) {
        const mat = new THREE.SpriteMaterial({
          map: mistTex,
          transparent: true,
          opacity: 0.16 + Math.random() * 0.12,
          depthWrite: false,
        });
        const s = new THREE.Sprite(mat);
        const top = i % 2 === 0;
        s.position.set(
          (Math.random() - 0.5) * 10,
          top ? 22 + Math.random() * 20 : -22 - Math.random() * 20,
          (Math.random() - 0.5) * 8,
        );
        s.scale.setScalar(26 + Math.random() * 22);
        scene.add(s);
        mists.push(s);
      }
    }

    // ---------- 漂浮尘埃 ----------
    const dustCount = small ? 180 : 420;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i += 1) {
      dustPos[i * 3] = (Math.random() - 0.5) * 40;
      dustPos[i * 3 + 1] = (Math.random() - 0.5) * 70;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0xcfe6ff,
      size: 0.07,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const dust = new THREE.Points(dustGeo, dustMat);
    scene.add(dust);

    // ---------- 光 ----------
    scene.add(new THREE.AmbientLight(0x2a3340, 0.9));
    const key = new THREE.PointLight(ACCENT, 90, 80);
    key.position.set(4, 2, 10);
    scene.add(key);
    const rim = new THREE.PointLight(COOL, 60, 90);
    rim.position.set(-8, -6, -6);
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
      targetPitch = THREE.MathUtils.clamp(
        targetPitch + dy * 0.0022,
        -0.35,
        0.35,
      );
      velYaw = dx * 0.0055;
    };
    const onUp = () => {
      dragging = false;
      renderer.domElement.style.cursor = "grab";
    };

    if (interactive) {
      renderer.domElement.style.cursor = "grab";
      renderer.domElement.addEventListener("pointerdown", onDown);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }

    // ---------- 循环 ----------
    const timer = new THREE.Timer();
    let raf = 0;
    let visible = true;

    const onVisibility = () => {
      visible = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVisibility);

    const render = () => {
      const t = timer.getElapsed();

      // 惯性：松手后继续滑一小段再停下，形成丝滑手感
      if (!dragging) {
        targetYaw += velYaw;
        velYaw *= 0.92;
        if (Math.abs(velYaw) < 0.00002) velYaw = 0;
        if (!reduceMotion) targetYaw += 0.00045;
      }
      yaw += (targetYaw - yaw) * 0.08;
      pitch += (targetPitch - pitch) * 0.08;

      const r = 30;
      camera.position.set(
        Math.sin(yaw) * r,
        pitch * 10 + (reduceMotion ? 0 : Math.sin(t * 0.12) * 0.5),
        Math.cos(yaw) * r,
      );
      camera.lookAt(0, pitch * 2, 0);

      // 叶片呼吸摆动：暖/冷两组分别写入各自的实例网格
      let warmIdx = 0;
      let coolIdx = 0;
      for (let i = 0; i < leafData.length; i += 1) {
        const d = leafData[i];
        const sway = reduceMotion
          ? 0
          : Math.sin(t * 0.8 + d.phase) * 0.28;
        tmpObj.position.set(
          d.base.x + Math.sin(d.phase) * 0.1,
          d.base.y + sway,
          d.base.z + Math.cos(d.phase) * 0.1,
        );
        tmpObj.rotation.set(t * 0.25 + d.phase, t * 0.2, 0);
        const s =
          d.scale *
          (reduceMotion ? 1 : 1 + Math.sin(t * 1.4 + d.phase) * 0.08);
        tmpObj.scale.setScalar(s);
        tmpObj.updateMatrix();
        if (d.warm) {
          warmLeaves.setMatrixAt(warmIdx, tmpObj.matrix);
          warmIdx += 1;
        } else {
          coolLeaves.setMatrixAt(coolIdx, tmpObj.matrix);
          coolIdx += 1;
        }
      }
      // 未使用的实例缩到 0，避免残影
      for (let i = warmIdx; i < warmLeaves.count; i += 1) {
        tmpObj.scale.setScalar(0);
        tmpObj.updateMatrix();
        warmLeaves.setMatrixAt(i, tmpObj.matrix);
      }
      for (let i = coolIdx; i < coolLeaves.count; i += 1) {
        tmpObj.scale.setScalar(0);
        tmpObj.updateMatrix();
        coolLeaves.setMatrixAt(i, tmpObj.matrix);
      }
      warmLeaves.instanceMatrix.needsUpdate = true;
      coolLeaves.instanceMatrix.needsUpdate = true;

      if (!reduceMotion) {
        dust.rotation.y = t * 0.02;
        const arr = dustGeo.attributes.position.array as Float32Array;
        for (let i = 1; i < arr.length; i += 3) {
          arr[i] += 0.012;
          if (arr[i] > 35) arr[i] = -35;
        }
        dustGeo.attributes.position.needsUpdate = true;
      }

      key.intensity = 90 + (reduceMotion ? 0 : Math.sin(t * 0.9) * 12);

      renderer.render(scene, camera);
      if (visible) raf = requestAnimationFrame(render);
      else raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    const onResize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (interactive) {
        renderer.domElement.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      }
      scene.traverse((obj) => {
        const o = obj as THREE.Mesh;
        if (o.geometry) o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else if (m) m.dispose();
      });
      mistTex?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [nodeCount, interactive]);

  return (
    <div
      ref={mountRef}
      className={className}
      aria-hidden="true"
      style={{
        // WebGL 不可用时的兜底：同样是深色云雾感，不会出现空白
        background:
          "radial-gradient(120% 70% at 50% 12%, rgba(216,255,117,0.10) 0%, rgba(9,11,16,0) 55%), radial-gradient(90% 60% at 50% 88%, rgba(107,184,255,0.10) 0%, rgba(9,11,16,0) 60%)",
      }}
    />
  );
}
