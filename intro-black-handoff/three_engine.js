import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ─── SCENE SETUP ────────────────────────────────────────────────────────────
const container = document.getElementById('canvas-3d-container');
const scene = new THREE.Scene();
const globalSceneGroup = new THREE.Group();
scene.add(globalSceneGroup);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 15);

scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
dirLight.position.set(5, 5, 10);
scene.add(dirLight);
const dirLight2 = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight2.position.set(-5, -5, -5);
scene.add(dirLight2);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 1.2, 0.5, 0.15
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// OrbitControls — chỉ xoay, không zoom
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableZoom = false;

// ─── PARTICLES ──────────────────────────────────────────────────────────────
const particleCount = 25000;
let particles, geometry;
let solidMeshes = [];

const targetPositions    = new Float32Array(particleCount * 3);
const targetColors       = new Float32Array(particleCount * 3);
const randomPositions    = new Float32Array(particleCount * 3);
const currentPositions   = new Float32Array(particleCount * 3);
const currentColors      = new Float32Array(particleCount * 3);
const randomSpeeds       = [];

// Mockup hologram target positions (from pixel sampling)
const targetPosMockup    = new Float32Array(particleCount * 3);

// Explosion
const explosionOffset    = new Float32Array(particleCount * 3);
const vx = new Float32Array(particleCount);
const vy = new Float32Array(particleCount);
const vz = new Float32Array(particleCount);
let explosionSuppressTimer = 0;
let hasExploded = false;

// ─── PIXEL SAMPLING — tạo hologram dots từ ảnh App ─────────────────────────
function sampleMockupPixels() {
    const img = new Image();
    img.src = 'mockup-1.png';
    img.onload = () => {
        const cvs = document.createElement('canvas');
        cvs.width = img.width; cvs.height = img.height;
        const ctx = cvs.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height).data;

        // Thu thập pixel sáng với trọng số theo độ sáng
        const pool = [];
        for (let y = 0; y < img.height; y += 2) {
            for (let x = 0; x < img.width; x += 2) {
                const idx = (y * img.width + x) * 4;
                const brightness = (data[idx] + data[idx+1] + data[idx+2]) / 3;
                if (brightness > 30) {
                    const weight = Math.ceil(brightness / 55);
                    for (let k = 0; k < weight; k++) pool.push({ x, y });
                }
            }
        }

        // Map pixel 2D → world 3D
        // Ảnh rộng 15 units, căn giữa màn hình, nằm thấp hơn tâm
        const W = 15;
        const H = W * (img.height / img.width);
        const ox = -W / 2;       // bắt đầu X (căn giữa)
        const oy = H / 2 - 4;    // bắt đầu Y (dịch xuống)

        for (let i = 0; i < particleCount; i++) {
            const p = pool[Math.floor(Math.random() * pool.length)];
            targetPosMockup[i*3]   = ox + (p.x / img.width)  * W;
            targetPosMockup[i*3+1] = oy - (p.y / img.height) * H;
            // Thêm độ sâu ngẫu nhiên để hologram trông không bị "phẳng dẹt"
            targetPosMockup[i*3+2] = (Math.random() - 0.5) * 0.5;
        }
    };
}
// Keep the sampler available for later, but do not run it in the black-handoff build.

// ─── HELPERS ────────────────────────────────────────────────────────────────
function explode() {
    explosionSuppressTimer = 3.5; // Tăng thời gian tan biến
    for (let i = 0; i < particleCount; i++) {
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.acos(2 * Math.random() - 1);

        // Tốc độ cực đại để bao phủ toàn màn hình (Sphere explosion)
        const speed = Math.random() * 150 + 80;

        vx[i] = speed * Math.sin(theta) * Math.cos(phi);
        vy[i] = speed * Math.sin(theta) * Math.sin(phi);
        vz[i] = speed * Math.cos(theta);

        // Lực xoáy hỗn loạn
        vx[i] += (Math.random() - 0.5) * 5;
        vy[i] += (Math.random() - 0.5) * 5;
        vz[i] += (Math.random() - 0.5) * 5;
        
        explosionOffset[i*3] = explosionOffset[i*3+1] = explosionOffset[i*3+2] = 0;
    }
}

function createCircleTexture() {
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = 64;
    const ctx = cvs.getContext('2d');
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    return new THREE.CanvasTexture(cvs);
}

// ─── GLB LOADER ─────────────────────────────────────────────────────────────
const loader = new GLTFLoader();

loader.load('3d_logo_typography.glb', (gltf) => {
    const geometries = [];
    let imageCanvas = document.createElement('canvas');
    let imageCtx = imageCanvas.getContext('2d', { willReadFrequently: true });
    let imageData = null;

    const solidGroup = gltf.scene;
    solidGroup.updateMatrixWorld(true);

    solidGroup.traverse((child) => {
        if (!child.isMesh) return;

        let geom = child.geometry.clone();
        geom.applyMatrix4(child.matrixWorld);
        if (geom.index) geom = geom.toNonIndexed();

        if (child.material?.map?.image && !imageData) {
            const img = child.material.map.image;
            imageCanvas.width = img.width;
            imageCanvas.height = img.height;
            imageCtx.drawImage(img, 0, 0);
            imageData = imageCtx.getImageData(0, 0, img.width, img.height);
        }

        const cleanGeom = new THREE.BufferGeometry();
        cleanGeom.setAttribute('position', geom.getAttribute('position'));
        if (geom.hasAttribute('uv')) cleanGeom.setAttribute('uv', geom.getAttribute('uv'));

        const count = geom.attributes.position.count;
        const colors = new Float32Array(count * 3);
        const cr = child.material?.color?.r ?? 1;
        const cg = child.material?.color?.g ?? 1;
        const cb = child.material?.color?.b ?? 1;
        for (let i = 0; i < count; i++) { colors[i*3]=cr; colors[i*3+1]=cg; colors[i*3+2]=cb; }
        cleanGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometries.push(cleanGeom);

        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.opacity = 0;
        child.material.depthWrite = true;
        if (child.material.roughness !== undefined) {
            child.material.roughness = 0.2;
            child.material.metalness = 0.8;
        }
        solidMeshes.push(child);
    });

    if (!geometries.length) return;

    let mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);

    const box = new THREE.Box3().setFromObject(solidGroup);
    const center = new THREE.Vector3();
    box.getCenter(center);
    let size = new THREE.Vector3();
    box.getSize(size);

    solidGroup.position.set(-center.x, -center.y, -center.z);
    mergedGeometry.translate(-center.x, -center.y, -center.z);

    let rotZ = 0;
    if (size.y > size.x && size.y > size.z) {
        rotZ = -Math.PI / 2;
        [size.x, size.y] = [size.y, size.x];
    }

    const logoWrapper = new THREE.Group();
    logoWrapper.add(solidGroup);
    logoWrapper.rotation.z = rotZ;
    mergedGeometry.rotateZ(rotZ);

    const maxDim = Math.max(size.x, size.y, size.z);
    const s = 8 / maxDim;
    logoWrapper.scale.setScalar(s);
    mergedGeometry.scale(s, s, s);
    globalSceneGroup.add(logoWrapper);

    const sampler = new MeshSurfaceSampler(
        new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial())
    ).build();

    const _pos = new THREE.Vector3();
    const _nor = new THREE.Vector3();
    const _col = new THREE.Color();
    const _uv  = new THREE.Vector2();

    for (let i = 0; i < particleCount; i++) {
        sampler.sample(_pos, _nor, _col, _uv);

        targetPositions[i*3]   = _pos.x;
        targetPositions[i*3+1] = _pos.y;
        targetPositions[i*3+2] = _pos.z;

        if (imageData && mergedGeometry.hasAttribute('uv')) {
            const u  = Math.max(0, Math.min(1, _uv.x));
            const v  = Math.max(0, Math.min(1, 1 - _uv.y));
            const px = Math.floor(u * (imageData.width  - 1));
            const py = Math.floor(v * (imageData.height - 1));
            const id = (py * imageData.width + px) * 4;
            let r = imageData.data[id]   / 255;
            let g = imageData.data[id+1] / 255;
            let b = imageData.data[id+2] / 255;
            const c = new THREE.Color(r, g, b).convertSRGBToLinear();
            targetColors[i*3] = c.r; targetColors[i*3+1] = c.g; targetColors[i*3+2] = c.b;
        } else {
            targetColors[i*3] = _col.r; targetColors[i*3+1] = _col.g; targetColors[i*3+2] = _col.b;
        }

        const r_s = 30 * Math.cbrt(Math.random());
        const th  = Math.random() * 2 * Math.PI;
        const ph  = Math.acos(2 * Math.random() - 1);
        randomPositions[i*3]   = currentPositions[i*3]   = r_s * Math.sin(ph) * Math.cos(th);
        randomPositions[i*3+1] = currentPositions[i*3+1] = r_s * Math.sin(ph) * Math.sin(th);
        randomPositions[i*3+2] = currentPositions[i*3+2] = r_s * Math.cos(ph) - 10;
        currentColors[i*3] = currentColors[i*3+1] = currentColors[i*3+2] = 1;

        randomSpeeds.push({
            rx: Math.random() * 0.5 + 0.2,
            ry: Math.random() * 0.5 + 0.2,
            rz: Math.random() * 0.5 + 0.2,
            ox: Math.random() * Math.PI * 2,
            oy: Math.random() * Math.PI * 2,
            oz: Math.random() * Math.PI * 2,
            amp: Math.random() * 2.0 + 1.0
        });
    }

    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(currentPositions, 3));
    geometry.setAttribute('color',    new THREE.Float32BufferAttribute(currentColors, 3));

    particles = new THREE.Points(geometry, new THREE.PointsMaterial({
        size: 0.12,
        vertexColors: true,
        map: createCircleTexture(),
        transparent: true,
        opacity: 0.8,
        alphaTest: 0.1,
        depthWrite: false
    }));
    globalSceneGroup.add(particles);

}, undefined, (err) => console.error('GLB Error:', err));

// ─── RESIZE ─────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

// ─── SCROLL ─────────────────────────────────────────────────────────────────
let scrollProgress = 0;
let smoothProgress = 0;
window.addEventListener('scroll', () => {
    const maxScroll = Math.max(1, document.body.scrollHeight - window.innerHeight);
    scrollProgress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
});

// ─── DOM REFS ────────────────────────────────────────────────────────────────
const heroText    = document.getElementById('hero-text');
const scrollInd   = document.getElementById('scroll-indicator');
const finalScreen = document.getElementById('final-screen');
const ctaButton   = document.querySelector('.cta-btn');
const ctaWrapper  = document.querySelector('.btn-wrapper');
const caseScreen  = document.querySelector('.case-screen');
const caseButtons = document.querySelectorAll('.case-btn');

if (ctaButton) {
    ctaButton.addEventListener('pointermove', (event) => {
        const rect = ctaButton.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;
        ctaButton.style.setProperty('--mx', `${x}%`);
        ctaButton.style.setProperty('--my', `${y}%`);
        ctaWrapper?.style.setProperty('--mx', `${x}%`);
        ctaWrapper?.style.setProperty('--my', `${y}%`);
    });

    ctaButton.addEventListener('pointerleave', () => {
        ctaButton.style.setProperty('--mx', '78%');
        ctaButton.style.setProperty('--my', '50%');
        ctaWrapper?.style.setProperty('--mx', '78%');
        ctaWrapper?.style.setProperty('--my', '50%');
    });
}

caseButtons.forEach((button) => {
    button.addEventListener('pointermove', (event) => {
        const rect = button.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;
        button.style.setProperty('--btn-x', `${x}%`);
        button.style.setProperty('--btn-y', `${y}%`);
        finalScreen?.style.setProperty('--case-glow-x', `${event.clientX}px`);
        finalScreen?.style.setProperty('--case-glow-y', `${event.clientY}px`);
    });

    button.addEventListener('pointerleave', () => {
        button.style.setProperty('--btn-x', '50%');
        button.style.setProperty('--btn-y', '50%');
    });
});

// ─── DOM REFS ────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    const dt   = clock.getDelta();
    const time = clock.getElapsedTime();
    const maxScroll = Math.max(1, document.body.scrollHeight - window.innerHeight);
    scrollProgress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
    smoothProgress += (scrollProgress - smoothProgress) * 5 * dt;

    // ──────────────────────────────────────────────────────────────────────
    //  SCROLL TIMELINE
    //  0.00 → 0.20  Hero text fade out
    //  0.10 → 0.50  Particles assemble → logo
    //  0.50 → 0.65  Logo solidifies (color fill)
    //  0.60 → 0.73  "Scroll to continue" visible
    //  0.75         AUTO EXPLODE
    //  0.84 → 1.00  Fade into a clean black handoff screen
    // ──────────────────────────────────────────────────────────────────────

    const blackHandoff = Math.max(0, Math.min(1, (smoothProgress - 0.84) / 0.16));
    bloomPass.strength = 1.2 - blackHandoff * 0.75;
    if (particles) particles.material.size = 0.12 - blackHandoff * 0.04;

    // Hero text
    if (heroText) {
        heroText.style.opacity   = Math.max(0, 1 - smoothProgress / 0.2);
        heroText.style.transform = `translateY(-${smoothProgress * 300}px)`;
    }

    // Scroll indicator
    if (scrollInd) {
        const showScrollCue = smoothProgress < 0.72;
        scrollInd.style.opacity = showScrollCue ? 1 : 0;
        scrollInd.style.transform = `translateY(${showScrollCue ? 0 : 12}px)`;
    }

    // Final screen HTML — fade-in phủ lên canvas
    if (finalScreen) {
        const finalFade = blackHandoff;
        const caseSlide = 0;
        const heroExit = 0;
        const caseFade = 0;
        finalScreen.style.opacity = finalFade;
        finalScreen.style.setProperty('--case-progress', caseSlide.toFixed(3));
        finalScreen.style.setProperty('--case-slide', caseSlide.toFixed(3));
        finalScreen.style.setProperty('--case-fade', caseFade.toFixed(3));
        finalScreen.style.setProperty('--hero-exit', heroExit.toFixed(3));
        // Chỉ block pointer khi đang hiển thị
        finalScreen.style.pointerEvents = 'none';
        if (caseScreen) {
            caseScreen.style.pointerEvents = caseFade > 0.12 ? 'auto' : 'none';
        }
    }

    // Auto-explode
    if (smoothProgress > 0.75 && !hasExploded) {
        hasExploded = true;
        explode();
    } else if (smoothProgress < 0.70 && hasExploded) {
        hasExploded = false;
        explosionSuppressTimer = 0;
        for (let i = 0; i < particleCount; i++) {
            vx[i] = vy[i] = vz[i] = 0;
            explosionOffset[i*3] = explosionOffset[i*3+1] = explosionOffset[i*3+2] = 0;
        }
    }

    if (particles && geometry) {
        // Phase 1: Assemble (0.10 → 0.50)
        const ap   = Math.max(0, Math.min(1, (smoothProgress - 0.10) / 0.40));
        const ep   = ap < 0.5 ? 2*ap*ap : 1 - Math.pow(-2*ap+2,2)/2; // ease in-out

        // Phase 2: Solidify color (0.50 → 0.65)
        const ec   = Math.max(0, Math.min(1, (smoothProgress - 0.50) / 0.15));

        // No mockup morph in this handoff build: logo explodes, then the page fades to black.
        const ml   = 0;

        // Opacity management
        let solidOp = ec * (1 - ml);
        let partOp  = (0.8 - ec * 0.8) * (1 - ml) + 0.9 * ml;

        if (explosionSuppressTimer > 0) {
            explosionSuppressTimer -= dt;
            const sup = Math.min(1, explosionSuppressTimer * 1.5);
            solidOp *= (1 - sup);
            partOp   = Math.max(partOp, 0.8 * sup);
        }

        solidMeshes.forEach(m => {
            m.material.opacity = solidOp;
            m.visible = solidOp > 0.005;
        });
        particles.material.opacity = partOp;
        particles.visible = partOp > 0.005;

        // Update positions + colors
        if (particles.visible || explosionSuppressTimer > 0) {
            const pos = geometry.attributes.position.array;
            const col = geometry.attributes.color.array;

            for (let i = 0; i < particleCount; i++) {
                const i3 = i * 3;
                const sp = randomSpeeds[i];

                // Explosion decay
                explosionOffset[i3]   += vx[i] * dt;
                explosionOffset[i3+1] += vy[i] * dt;
                explosionOffset[i3+2] += vz[i] * dt;
                vx[i] *= 0.92; vy[i] *= 0.92; vz[i] *= 0.92;
                explosionOffset[i3]   *= 0.97;
                explosionOffset[i3+1] *= 0.97;
                explosionOffset[i3+2] *= 0.97;

                // Float
                const fx = randomPositions[i3]   + Math.sin(time * sp.rx + sp.ox) * sp.amp;
                const fy = randomPositions[i3+1] + Math.cos(time * sp.ry + sp.oy) * sp.amp;
                const fz = randomPositions[i3+2] + Math.sin(time * sp.rz + sp.oz) * sp.amp;

                // Float → Logo
                let x = fx*(1-ep) + targetPositions[i3]*ep;
                let y = fy*(1-ep) + targetPositions[i3+1]*ep;
                let z = fz*(1-ep) + targetPositions[i3+2]*ep;

                // Logo → Hologram dots
                x = x*(1-ml) + targetPosMockup[i3]*ml;
                y = y*(1-ml) + targetPosMockup[i3+1]*ml;
                z = z*(1-ml) + targetPosMockup[i3+2]*ml;

                pos[i3]   = x + explosionOffset[i3];
                pos[i3+1] = y + explosionOffset[i3+1];
                pos[i3+2] = z + explosionOffset[i3+2];

                // Colors: white → logo color → hologram blue/orange glow
                if (ml > 0.01) {
                    const baseR = 0.10, baseG = 0.20, baseB = 0.40;
                    const glowR = 1.00, glowG = 0.50, glowB = 0.10;
                    // Simple per-particle oscillating glow
                    const glow = Math.max(0, Math.sin(time * 2 + i * 0.001) * 0.5 + 0.5) * 0.4;
                    const r = baseR + glowR * glow;
                    const g = baseG + glowG * glow;
                    const b = baseB + glowB * glow;
                    const or = 1*(1-ec) + targetColors[i3]*ec;
                    const og = 1*(1-ec) + targetColors[i3+1]*ec;
                    const ob = 1*(1-ec) + targetColors[i3+2]*ec;
                    col[i3]   = or*(1-ml) + r*ml;
                    col[i3+1] = og*(1-ml) + g*ml;
                    col[i3+2] = ob*(1-ml) + b*ml;
                } else {
                    col[i3]   = 1*(1-ec) + targetColors[i3]*ec;
                    col[i3+1] = 1*(1-ec) + targetColors[i3+1]*ec;
                    col[i3+2] = 1*(1-ec) + targetColors[i3+2]*ec;
                }
            }
            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.color.needsUpdate    = true;
        }

        // Rotation
        if (smoothProgress > 0.75) {
            // Flatten khi sang mockup phase
            globalSceneGroup.rotation.y += (0 - globalSceneGroup.rotation.y) * 0.08;
            globalSceneGroup.rotation.x += (0 - globalSceneGroup.rotation.x) * 0.08;
        } else if (smoothProgress > 0.50) {
            // Logo đặc: gentle sway
            globalSceneGroup.rotation.y = Math.sin(time * 0.2) * 0.15;
            globalSceneGroup.rotation.x = Math.sin(time * 0.1) * 0.05;
        } else {
            // Drifting
            globalSceneGroup.rotation.y += 0.001;
            globalSceneGroup.rotation.x += 0.0005;
        }
    }

    composer.render();

}

animate();
