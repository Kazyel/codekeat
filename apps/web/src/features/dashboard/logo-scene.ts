import {
	Color,
	DirectionalLight,
	ExtrudeGeometry,
	Group,
	HemisphereLight,
	Mesh,
	MeshPhysicalMaterial,
	MeshStandardMaterial,
	PerspectiveCamera,
	PlaneGeometry,
	Scene,
	ShaderMaterial,
	Uniform,
	Vector2,
	Vector4,
	WebGLRenderer,
} from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";

import signalBackgroundFragment from "./signal-background.glsl?raw";

type LogoMesh = Mesh<ExtrudeGeometry, [MeshPhysicalMaterial, MeshStandardMaterial]>;

function createLogoMeshes(svg: string): LogoMesh[] {
	const { paths } = new SVGLoader().parse(svg);
	if (paths.length === 0) throw new Error("The logo SVG contains no geometry.");
	return paths.map((path) => {
		const geometry = new ExtrudeGeometry(path.toShapes(), {
			depth: 140,
			steps: 1,
			bevelEnabled: true,
			bevelSegments: 3,
			bevelSize: 4,
			bevelThickness: 10,
			curveSegments: 8,
		});
		geometry.translate(-627, -627, -70);

		return new Mesh(geometry, [
			new MeshPhysicalMaterial({
				color: path.color,
				metalness: 0.15,
				roughness: 0.28,
				clearcoat: 0.8,
				clearcoatRoughness: 0.2,
			}),
			new MeshStandardMaterial({
				color: path.color.clone().multiplyScalar(0.45),
				metalness: 0.25,
				roughness: 0.32,
			}),
		]);
	});
}

function disposeMeshes(meshes: readonly LogoMesh[]): void {
	for (const mesh of meshes) {
		mesh.geometry.dispose();
		for (const material of mesh.material) material.dispose();
	}
}

function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer | null {
	try {
		return new WebGLRenderer({
			canvas,
			alpha: true,
			antialias: true,
			powerPreference: "low-power",
		});
	} catch {
		// Decorative 3D is optional: the component keeps the original SVG visible.
		return null;
	}
}

function addLighting(scene: Scene): void {
	const key = new DirectionalLight("#fff3e6", 2.5);
	key.position.set(-3, 4, 5);
	const fill = new DirectionalLight("#ffffff", 1.2);
	fill.position.set(4, 1, 3);
	const rim = new DirectionalLight("#fc6701", 2);
	rim.position.set(-3, -2, -3);
	scene.add(new HemisphereLight("#ffffff", "#38150b", 1.3), key, fill, rim);
}

export function mountLogoScene(
	canvas: HTMLCanvasElement,
	host: HTMLElement,
	svg: string,
	onUnavailable: () => void,
): (() => void) | null {
	const meshes = createLogoMeshes(svg);
	const renderer = createRenderer(canvas);
	if (renderer === null) {
		disposeMeshes(meshes);
		return null;
	}

	const scene = new Scene();
	const camera = new PerspectiveCamera(36, 1, 0.1, 20);
	camera.position.z = 3.85;
	const logo = new Group();
	logo.add(...meshes);
	logo.scale.set(0.002, -0.002, 0.002);
	scene.add(logo);
	addLighting(scene);
	renderer.autoClear = false;

	const uniforms = {
		uTime: new Uniform(0),
		uContrast: new Uniform(1),
		uResolution: new Uniform(new Vector2(1, 1)),
		uBase: new Uniform(new Color()),
		uRed: new Uniform(new Color()),
		uOrange: new Uniform(new Color()),
	};
	const backgroundGeometry = new PlaneGeometry(2, 2);
	const backgroundMaterial = new ShaderMaterial({
		uniforms,
		vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = vec4(position.xy, 0.999, 1.0);
			}
		`,
		fragmentShader: signalBackgroundFragment,
		depthTest: false,
		depthWrite: false,
	});
	const backdrop = new Mesh(backgroundGeometry, backgroundMaterial);
	backdrop.frustumCulled = false;
	const background = new Scene();
	background.add(backdrop);
	const viewport = new Vector4();

	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	const startedAt = performance.now();
	let visible = false;
	let frame = 0;
	let lastFrame = 0;

	const render = (seconds: number): void => {
		logo.rotation.set(
			0.12 + Math.sin(seconds * 0.35) * 0.05,
			-0.45 + Math.sin(seconds * 0.25) * 0.14,
			-0.06,
		);
		logo.position.y = Math.sin(seconds * 0.4) * 0.035;
		uniforms.uTime.value = seconds;
		renderer.setViewport(0, 0, uniforms.uResolution.value.x, uniforms.uResolution.value.y);
		renderer.clear();
		renderer.render(background, camera);
		renderer.setViewport(viewport);
		renderer.render(scene, camera);
	};
	const animate = (now: number): void => {
		if (now - lastFrame >= 1000 / 30) {
			render((now - startedAt) / 1000);
			lastFrame = now;
		}
		frame = requestAnimationFrame(animate);
	};
	const syncAnimation = (): void => {
		cancelAnimationFrame(frame);
		if (!visible || document.hidden) return;
		render(0);
		if (!reducedMotion.matches) frame = requestAnimationFrame(animate);
	};
	const resize = (): void => {
		const surface = canvas.getBoundingClientRect();
		const art = host.getBoundingClientRect();
		if (surface.width === 0 || art.height === 0) return;
		renderer.setPixelRatio(
			Math.min(
				window.devicePixelRatio,
				1.5,
				Math.sqrt(650_000 / (surface.width * surface.height)),
			),
		);
		renderer.setSize(surface.width, surface.height, false);
		uniforms.uResolution.value.set(surface.width, surface.height);
		viewport.set(
			art.left - surface.left,
			surface.height - (art.top - surface.top) - art.height,
			art.width,
			art.height,
		);
		camera.aspect = art.width / art.height;
		camera.updateProjectionMatrix();
		render(0);
	};
	const syncTheme = (): void => {
		const style = getComputedStyle(host);
		uniforms.uBase.value.setStyle(style.getPropertyValue("--card").trim());
		uniforms.uRed.value.setStyle(style.getPropertyValue("--primary").trim());
		uniforms.uOrange.value.setStyle(style.getPropertyValue("--accent").trim());
		uniforms.uContrast.value = document.documentElement.classList.contains("dark") ? 1 : 1.8;
		if (visible) render(0);
	};
	const handleContextLoss = (): void => {
		sizeObserver.disconnect();
		visibilityObserver.disconnect();
		visible = false;
		syncAnimation();
		onUnavailable();
	};

	const sizeObserver = new ResizeObserver(resize);
	const visibilityObserver = new IntersectionObserver(([entry]) => {
		visible = entry?.isIntersecting ?? false;
		syncAnimation();
	});
	const themeObserver = new MutationObserver(syncTheme);
	syncTheme();
	resize();
	sizeObserver.observe(host);
	sizeObserver.observe(canvas);
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});
	visibilityObserver.observe(host);
	reducedMotion.addEventListener("change", syncAnimation);
	document.addEventListener("visibilitychange", syncAnimation);
	canvas.addEventListener("webglcontextlost", handleContextLoss);

	return () => {
		cancelAnimationFrame(frame);
		sizeObserver.disconnect();
		visibilityObserver.disconnect();
		themeObserver.disconnect();
		reducedMotion.removeEventListener("change", syncAnimation);
		document.removeEventListener("visibilitychange", syncAnimation);
		canvas.removeEventListener("webglcontextlost", handleContextLoss);
		disposeMeshes(meshes);
		backgroundGeometry.dispose();
		backgroundMaterial.dispose();
		renderer.dispose();
		renderer.forceContextLoss();
	};
}
