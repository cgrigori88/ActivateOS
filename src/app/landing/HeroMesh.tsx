"use client";

import { useEffect, useRef } from "react";

/**
 * Hero background: the reference's torus, reproduced as-is.
 *
 * Geometry, materials, placement and motion are all the reference's values —
 * TorusGeometry(22, 7, 120, 250) wireframed, two layered LineBasicMaterials
 * (#2563eb at 0.15 and #60a5fa at 0.10, additive, depthWrite off, the inner copy
 * scaled to 0.98 and offset half a segment), parked at y 18 so the tube arches
 * over the top of the frame, tilted 0.1π, and turning at time += 0.0015 with
 * rotation.z = time * 0.5.
 *
 * An earlier version made our mark the subject instead of the torus. It is in
 * the history if we want it back, but the mark cannot carry a tube this fat:
 * the wall between its outer edge and the large counter is only 4.6 units, and
 * 3.0 to the small counter, so a tube of radius 7 collides with itself and the
 * mark stops reading.
 */

const RADIAL_SEGMENTS = 120;
const TUBULAR_SEGMENTS = 250;
const BASE_Y = 18;

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
      camera.lookAt(0, 5, 0);

      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.setSize(width(), height());
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);

      const geometry = new THREE.TorusGeometry(22, 7, RADIAL_SEGMENTS, TUBULAR_SEGMENTS);
      const edges = new THREE.WireframeGeometry(geometry);

      const torusGroup = new THREE.Group();

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
      lineInner.rotation.z = Math.PI / RADIAL_SEGMENTS;

      torusGroup.add(lineOuter);
      torusGroup.add(lineInner);

      torusGroup.rotation.x = Math.PI * 0.1;
      scene.add(torusGroup);

      /**
       * The reference's camera framing assumes a landscape container. On a
       * narrow viewport the visible width collapses and the arch falls entirely
       * outside the frame, leaving just a slab of tube across the bottom — so
       * the torus scales down with the aspect ratio and its height scales with
       * it, keeping the arch in shot. At the reference's own proportions this
       * is a no-op.
       */
      let baseY = BASE_Y;
      const applyLayout = () => {
        const aspect = width() / height();
        const scale = aspect < 1.25 ? Math.max(0.45, aspect / 1.25) : 1;
        torusGroup.scale.setScalar(scale);
        baseY = BASE_Y * scale;
        torusGroup.position.set(0, baseY, 0);
      };
      applyLayout();

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      let time = 0;
      const animate = () => {
        frame = requestAnimationFrame(animate);
        time += 0.0015;

        torusGroup.rotation.z = time * 0.5;
        torusGroup.rotation.y = Math.sin(time) * 0.05;
        torusGroup.position.y = baseY + Math.sin(time * 2) * 0.5;

        renderer.render(scene, camera);
      };

      if (reduced) {
        // A single static frame rather than a running loop.
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
        geometry.dispose();
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
