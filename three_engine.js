import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// Post Processing Modules (Bloom Effect)
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const container = document.getElementById('canvas-3d-container');

const scene = new THREE.Scene();

const globalSceneGroup = new THREE.Group();
scene.add(globalSceneGroup);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 15);

// Ánh sáng tôn lên độ bóng bẩy (Metallic) của Logo
const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
scene.add(ambientLight);
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

// --- CẤU HÌNH POST-PROCESSING (BLOOM) ---
const renderScene = new RenderPass(scene, camera);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.2,  // Sức mạnh của luồng sáng (Glow strength)
    0.5,  // Bán kính sáng
    0.15  // Ngưỡng ánh sáng để bắt đầu Glow (Để các hạt bụi trắng tự động phát sáng)
);

const outputPass = new OutputPass(); // Đảm bảo ToneMapping hoạt động chuẩn xác qua Composer

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);
composer.addPass(outputPass);
// ------------------------------------------

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableZoom = false; 

const particleCount = 25000; 
let particles, geometry;
let solidMeshes = [];

const targetPositions = new Float32Array(particleCount * 3);
const targetColors = new Float32Array(particleCount * 3);

const randomPositions = new Float32Array(particleCount * 3); 
const currentPositions = new Float32Array(particleCount * 3); 
const currentColors = new Float32Array(particleCount * 3); 

const randomSpeeds = [];

const explosionOffset = new Float32Array(particleCount * 3);
const vx = new Float32Array(particleCount);
const vy = new Float32Array(particleCount);
const vz = new Float32Array(particleCount);
let explosionSuppressTimer = 0;

let scrollProgress = 0;
let smoothProgress = 0;

window.addEventListener('scroll', () => {
    let maxScroll = Math.max(1, document.body.scrollHeight - window.innerHeight);
    scrollProgress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
});

window.addEventListener('mousedown', () => {
    // Chỉ nổ khi cuộn chuột đã đủ sâu (Logo đã hóa rắn)
    if (smoothProgress > 0.8) {
        explode();
    }
});

function explode() {
    explosionSuppressTimer = 2.0; 
    for (let i = 0; i < particleCount; i++) {
        let angle = Math.random() * Math.PI * 2;
        let speed = Math.random() * 30 + 10; 
        vx[i] = Math.cos(angle) * speed;
        vy[i] = Math.sin(angle) * speed;
        vz[i] = (Math.random() - 0.5) * 45; 
        
        explosionOffset[i*3] = 0;
        explosionOffset[i*3+1] = 0;
        explosionOffset[i*3+2] = 0;
    }
}

function createCircleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
}

const loader = new GLTFLoader();
loader.load('3d_logo_typography.glb', function (gltf) {
    let geometries = [];
    
    let imageCanvas = document.createElement('canvas');
    let imageCtx = imageCanvas.getContext('2d', { willReadFrequently: true });
    let imageData = null;

    const solidGroup = gltf.scene;
    solidGroup.updateMatrixWorld(true);
    
    solidGroup.traverse((child) => {
        if (child.isMesh) {
            let geom = child.geometry.clone();
            geom.applyMatrix4(child.matrixWorld);
            if (geom.index) geom = geom.toNonIndexed();
            
            if (child.material && child.material.map && child.material.map.image && !imageData) {
                let img = child.material.map.image;
                imageCanvas.width = img.width;
                imageCanvas.height = img.height;
                imageCtx.drawImage(img, 0, 0);
                imageData = imageCtx.getImageData(0, 0, img.width, img.height);
            }
            
            let cleanGeom = new THREE.BufferGeometry();
            cleanGeom.setAttribute('position', geom.getAttribute('position'));
            
            if (geom.hasAttribute('uv')) {
                cleanGeom.setAttribute('uv', geom.getAttribute('uv'));
            }
            
            if (!geom.hasAttribute('color')) {
                const count = geom.attributes.position.count;
                const colors = new Float32Array(count * 3);
                let r = 1, g = 1, b = 1;
                if (child.material && child.material.color) {
                    r = child.material.color.r;
                    g = child.material.color.g;
                    b = child.material.color.b;
                }
                for (let i = 0; i < count; i++) {
                    colors[i*3] = r;
                    colors[i*3+1] = g;
                    colors[i*3+2] = b;
                }
                cleanGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            } else {
                cleanGeom.setAttribute('color', geom.getAttribute('color'));
            }
            
            geometries.push(cleanGeom);
            
            // Xử lý Material Khối Đặc
            child.material = child.material.clone();
            child.material.transparent = true;
            child.material.opacity = 0; 
            // FIX LỖI XOAY MÓP MÉO: Bật lại Depth Write để các mặt trước sau sắp xếp đúng!
            child.material.depthWrite = true; 
            
            // Tăng xíu độ bóng nếu là vật liệu PBR (MeshStandardMaterial)
            if(child.material.roughness !== undefined) {
                child.material.roughness = 0.2; // Rất bóng bẩy
                child.material.metalness = 0.8; // Rất kim loại
            }
            
            solidMeshes.push(child);
        }
    });
    
    if (geometries.length === 0) return;
    
    let mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
    
    const box = new THREE.Box3().setFromObject(solidGroup);
    const center = new THREE.Vector3();
    box.getCenter(center);
    let size = new THREE.Vector3();
    box.getSize(size);
    
    solidGroup.position.set(-center.x, -center.y, -center.z);
    mergedGeometry.translate(-center.x, -center.y, -center.z);
    
    let rotationZ = 0;
    if (size.y > size.x && size.y > size.z) {
        rotationZ = -Math.PI / 2;
        let tmp = size.x;
        size.x = size.y;
        size.y = tmp;
    }
    
    const logoWrapper = new THREE.Group();
    logoWrapper.add(solidGroup);
    logoWrapper.rotation.z = rotationZ;
    mergedGeometry.rotateZ(rotationZ);
    
    const maxDim = Math.max(size.x, size.y, size.z);
    const scaleTarget = 8; 
    logoWrapper.scale.set(scaleTarget/maxDim, scaleTarget/maxDim, scaleTarget/maxDim);
    mergedGeometry.scale(scaleTarget/maxDim, scaleTarget/maxDim, scaleTarget/maxDim);
    
    globalSceneGroup.add(logoWrapper);
    
    const tempMesh = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial());
    const sampler = new MeshSurfaceSampler(tempMesh).build();
    
    const _position = new THREE.Vector3();
    const _normal = new THREE.Vector3();
    const _color = new THREE.Color();
    const _uv = new THREE.Vector2();
    
    for (let i = 0; i < particleCount; i++) {
        sampler.sample(_position, _normal, _color, _uv);
        
        targetPositions[i*3] = _position.x;
        targetPositions[i*3+1] = _position.y;
        targetPositions[i*3+2] = _position.z;
        
        if (imageData && mergedGeometry.hasAttribute('uv')) {
            let u = Math.max(0, Math.min(1, _uv.x));
            let v = Math.max(0, Math.min(1, _uv.y));
            v = 1 - v; 
            
            let x = Math.floor(u * (imageData.width - 1));
            let y = Math.floor(v * (imageData.height - 1));
            let idx = (y * imageData.width + x) * 4;
            
            targetColors[i*3] = imageData.data[idx] / 255.0;
            targetColors[i*3+1] = imageData.data[idx+1] / 255.0;
            targetColors[i*3+2] = imageData.data[idx+2] / 255.0;
            
            const c = new THREE.Color(targetColors[i*3], targetColors[i*3+1], targetColors[i*3+2]);
            c.convertSRGBToLinear();
            targetColors[i*3] = c.r;
            targetColors[i*3+1] = c.g;
            targetColors[i*3+2] = c.b;
        } else {
            targetColors[i*3] = _color.r;
            targetColors[i*3+1] = _color.g;
            targetColors[i*3+2] = _color.b;
        }
        
        let r_sphere = 30 * Math.cbrt(Math.random());
        let theta = Math.random() * 2 * Math.PI;
        let phi = Math.acos(2 * Math.random() - 1);
        
        let randX = r_sphere * Math.sin(phi) * Math.cos(theta);
        let randY = r_sphere * Math.sin(phi) * Math.sin(theta);
        let randZ = r_sphere * Math.cos(phi);
        
        // Push hạt ra xa camera 1 chút để làm nền lúc đầu
        randZ -= 10;
        
        randomPositions[i*3] = randX;
        randomPositions[i*3+1] = randY;
        randomPositions[i*3+2] = randZ;
        
        currentPositions[i*3] = randX;
        currentPositions[i*3+1] = randY;
        currentPositions[i*3+2] = randZ;
        
        // Hạt bụi màu trắng (sẽ tỏa sáng rực rỡ dưới hiệu ứng Bloom)
        currentColors[i*3] = 1;
        currentColors[i*3+1] = 1;
        currentColors[i*3+2] = 1;
        
        randomSpeeds.push({
            rx: Math.random() * 0.5 + 0.2,
            ry: Math.random() * 0.5 + 0.2,
            rz: Math.random() * 0.5 + 0.2,
            offsetX: Math.random() * Math.PI * 2,
            offsetY: Math.random() * Math.PI * 2,
            offsetZ: Math.random() * Math.PI * 2,
            amp: Math.random() * 2.0 + 1.0 
        });
    }
    
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(currentPositions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(currentColors, 3));
    
    const material = new THREE.PointsMaterial({
        size: 0.12, 
        vertexColors: true,
        map: createCircleTexture(),
        transparent: true,
        opacity: 0.8,
        alphaTest: 0.1, 
        depthWrite: false // Bụi hạt thì không ghi depth là đúng
    });
    
    particles = new THREE.Points(geometry, material);
    globalSceneGroup.add(particles);
    
}, undefined, function (error) {
    console.error('GLB Load Error:', error);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight); // Nhớ resize cả composer
});

const clock = new THREE.Clock();

const heroText = document.getElementById('hero-text');

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    let dt = clock.getDelta();
    let time = clock.getElapsedTime();
    
    // Smooth scroll progress
    smoothProgress += (scrollProgress - smoothProgress) * 5.0 * dt;
    
    // --- ANIMATION UI HTML ---
    if (heroText) {
        // Text từ từ biến mất khi scroll 20% đầu
        let textOpacity = Math.max(0, 1 - smoothProgress / 0.2);
        heroText.style.opacity = textOpacity;
        heroText.style.transform = `translateY(-${smoothProgress * 300}px)`;
    }
    
    if (particles && geometry) {
        
        // --- ÁNH XẠ SCROLL VÀO 3D ---
        // 1. Lắp ráp vị trí: Bắt đầu ráp sau khi Text mờ đi (0.1 -> 0.6)
        let assembleProgress = Math.max(0, Math.min(1, (smoothProgress - 0.1) / 0.5));
        let easePos = assembleProgress < 0.5 ? 2 * assembleProgress * assembleProgress : 1 - Math.pow(-2 * assembleProgress + 2, 2) / 2;
        
        // 2. Phủ màu & Hóa rắn: Từ 0.6 -> 1.0
        let easeCol = Math.max(0, Math.min(1, (smoothProgress - 0.6) / 0.4));
        
        let mappedSolidOpacity = easeCol;
        let mappedParticleOpacity = 0.8 - mappedSolidOpacity * 0.8;
        
        let solidOpacity = mappedSolidOpacity;
        let particleOpacity = mappedParticleOpacity;
        
        // VỤ NỔ
        if (explosionSuppressTimer > 0) {
            explosionSuppressTimer -= dt;
            let suppression = Math.min(1, explosionSuppressTimer * 1.5); 
            solidOpacity *= (1 - suppression);
            particleOpacity = Math.max(particleOpacity, 0.8 * suppression);
        }
        
        solidMeshes.forEach(m => {
            m.material.opacity = solidOpacity;
            m.visible = solidOpacity > 0.005;
        });
        particles.material.opacity = particleOpacity;
        particles.visible = particleOpacity > 0.005;
        
        if (particles.visible || explosionSuppressTimer > 0) {
            const positions = geometry.attributes.position.array;
            const colors = geometry.attributes.color.array;
            
            for (let i = 0; i < particleCount; i++) {
                let i3 = i * 3;
                
                explosionOffset[i3] += vx[i] * dt;
                explosionOffset[i3+1] += vy[i] * dt;
                explosionOffset[i3+2] += vz[i] * dt;
                
                vx[i] *= 0.92;
                vy[i] *= 0.92;
                vz[i] *= 0.92;
                
                explosionOffset[i3] *= 0.98;
                explosionOffset[i3+1] *= 0.98;
                explosionOffset[i3+2] *= 0.98;
                
                let speeds = randomSpeeds[i];
                let floatX = randomPositions[i3]     + Math.sin(time * speeds.rx + speeds.offsetX) * speeds.amp;
                let floatY = randomPositions[i3+1] + Math.cos(time * speeds.ry + speeds.offsetY) * speeds.amp;
                let floatZ = randomPositions[i3+2] + Math.sin(time * speeds.rz + speeds.offsetZ) * speeds.amp;
                
                let targX = targetPositions[i3];
                let targY = targetPositions[i3+1];
                let targZ = targetPositions[i3+2];
                
                let finalX = floatX * (1 - easePos) + targX * easePos;
                let finalY = floatY * (1 - easePos) + targY * easePos;
                let finalZ = floatZ * (1 - easePos) + targZ * easePos;
                
                positions[i3]   = finalX + explosionOffset[i3];
                positions[i3+1] = finalY + explosionOffset[i3+1];
                positions[i3+2] = finalZ + explosionOffset[i3+2];
                
                colors[i3]   = 1 * (1 - easeCol) + targetColors[i3]   * easeCol;
                colors[i3+1] = 1 * (1 - easeCol) + targetColors[i3+1] * easeCol;
                colors[i3+2] = 1 * (1 - easeCol) + targetColors[i3+2] * easeCol;
            }
            geometry.attributes.position.needsUpdate = true;
            geometry.attributes.color.needsUpdate = true;
        }
        
        if (smoothProgress > 0.8) {
            globalSceneGroup.rotation.y = Math.sin(time * 0.2) * 0.15; 
            globalSceneGroup.rotation.x = Math.sin(time * 0.1) * 0.05;
        } else {
            globalSceneGroup.rotation.y += 0.001;
            globalSceneGroup.rotation.x += 0.0005;
        }
    }
    
    // Sử dụng COMPOSER thay cho Renderer để có hiệu ứng Ánh sáng viền (Bloom)
    composer.render();
}

animate();
