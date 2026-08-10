"use client";

import { useEffect, useRef } from "react";

/**
 * Hero background: the PursuitOS mark rendered as a dense rotating wireframe.
 *
 * The reference used a TorusGeometry — one hole. The subject here is our own
 * mark instead: a disc carrying two voids on one axis, extruded and wireframed.
 * Everything else is kept from the reference: the two layered LineBasicMaterials
 * (#2563eb at 0.15, #60a5fa at 0.10, additive, depthWrite off, the inner copy
 * scaled to 0.98 and rotated half a segment), the rotation speed (time += 0.0015,
 * rotation.z = time * 0.5), the y wobble, and the float.
 *
 * Mark construction on the 48-unit grid, recentred and y-flipped for WebGL:
 *   outer circle  centre (0, 0)    radius 20
 *   large counter centre (-5, -2)  radius 10
 *   small counter centre (11, 7)   radius 4
 * The counters sit 18.36 units apart on a bearing of 29.36°, matching the
 * handoff's fixed bearing.
 */

const CURVE_SEGMENTS = 110;

export function HeroMesh() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let frame = 0;
    let cleanup: (() => void) | undefined;

    // Loaded on the client only — WebGL has no meaning during prerender.
    import("three").then((THREE) => {
      if (disposed || !container) return;

      const width = () => container.clientWidth || 1;
      const height = () => container.clientHeight || 1;

      const scene = new THREE.Scene();

      const camera = new THREE.PerspectiveCamera(60, width() / height(), 0.1, 1000);
      camera.position.set(0, -2, 28);
      camera.lookAt(0, 2, 0);

      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.setSize(width(), height());
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);

      // ---- The mark as a solid with two voids --------------------------
      const shape = new THREE.Shape();
      shape.absarc(0, 0, 20, 0, Math.PI * 2, false);

      const largeCounter = new THREE.Path();
      largeCounter.absarc(-5, -2, 10, 0, Math.PI * 2, true);

      const smallCounter = new THREE.Path();
      smallCounter.absarc(11, 7, 4, 0, Math.PI * 2, true);

      shape.holes.push(largeCounter, smallCounter);

      const solid = new THREE.ExtrudeGeometry(shape, {
        depth: 9,
        steps: 22,
        curveSegments: CURVE_SEGMENTS,
        bevelEnabled: true,
        bevelThickness: 2,
        bevelSize: 2,
        bevelOffset: 0,
        bevelSegments: 14,
      });

      /**
       * Keep only the swept side walls (materialIndex 1) and discard the flat
       * caps. The caps are earcut-triangulated, which reads as coarse triangle
       * fans across the face; the walls are a regular ring grid and give the
       * dense, even mesh the reference gets from a torus.
       */
      const sideGroup = solid.groups.find((g) => g.materialIndex === 1) ?? solid.groups[0];
      const position = solid.getAttribute("position");
      const shell = new THREE.BufferGeometry();
      shell.setAttribute(
        "position",
        new THREE.BufferAttribute(
          (position.array as Float32Array).slice(
            sideGroup.start * 3,
            (sideGroup.start + sideGroup.count) * 3,
          ),
          3,
        ),
      );
      shell.center();

      const edges = new THREE.WireframeGeometry(shell);

      const markGroup = new THREE.Group();

      const matOuter = new THREE.LineBasicMaterial({
        color: 0x2563eb,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const lineOuter = new THREE.LineSegments(edges, matOuter);

      const matInner = new THREE.LineBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const lineInner = new THREE.LineSegments(edges, matInner);
      lineInner.scale.set(0.98, 0.98, 0.98);
      lineInner.rotation.z = Math.PI / CURVE_SEGMENTS;

      markGroup.add(lineOuter);
      markGroup.add(lineInner);

      const BASE_Y = 1;
      markGroup.rotation.x = Math.PI * 0.1;

      /**
       * Size and place the mark so the full outer circle stays in frame and
       * both counters read — the small one is what makes the mark register as
       * aim rather than as a letter with a hole in it. On a narrow viewport the
       * visible width collapses, so the mark shrinks and recentres instead of
       * running off the right edge.
       */
      const applyLayout = () => {
        const aspect = width() / height();
        const narrow = aspect < 1;
        markGroup.scale.setScalar(narrow ? 0.5 * Math.max(0.5, aspect * 0.85) : 0.5);
        markGroup.position.set(narrow ? 0 : 3, BASE_Y, 0);
      };
      applyLayout();

      scene.add(markGroup);

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      let time = 0;
      const animate = () => {
        frame = requestAnimationFrame(animate);
        time += 0.0015;

        markGroup.rotation.z = time * 0.5;
        markGroup.rotation.y = Math.sin(time) * 0.05;
        markGroup.position.y = BASE_Y + Math.sin(time * 2) * 0.5;

        renderer.render(scene, camera);
      };

      if (reduced) {
        // Scroll is the only clock elsewhere; with reduced motion this holds a
        // single static frame rather than animating.
        renderer.render(scene, camera);
      } else {
        animate();
      }

      const handleResize = () => {
        camera.aspect = width() / height();
        camera.updateProjectionMatrix();
        renderer.setSize(width(), height());
        applyLayout();
        if (reduced) renderer.render(scene, camera);
      };
      window.addEventListener("resize", handleResize);

      const observer = new ResizeObserver(handleResize);
      observer.observe(container);

      cleanup = () => {
        if (frame) cancelAnimationFrame(frame);
        window.removeEventListener("resize", handleResize);
        observer.disconnect();
        edges.dispose();
        shell.dispose();
        solid.dispose();
        matOuter.dispose();
        matInner.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
      };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 z-0 pointer-events-none" aria-hidden />;
}
