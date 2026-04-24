// Register GSAP plugins
gsap.registerPlugin(ScrollTrigger, TextPlugin);

// 1. Typing Animation (Hero)
gsap.to("#typing-text", {
    duration: 2,
    text: "Antigravity.",
    ease: "none",
    delay: 0.5,
    onComplete: () => {
        gsap.to(".subtitle", {
            opacity: 1,
            y: 0,
            duration: 1,
            ease: "power2.out"
        });
    }
});

// 2. Background Color Transition
ScrollTrigger.create({
    trigger: ".experience-black",
    start: "top 70%",
    end: "top 30%",
    scrub: 1,
    onEnter: () => gsap.to("body", { backgroundColor: "#000", color: "#fff", duration: 1 }),
    onLeaveBack: () => gsap.to("body", { backgroundColor: "#fff", color: "#202124", duration: 1 })
});

// 3. Mockup 3D Rotation Animation
gsap.to(".browser-mockup", {
    rotateX: 0,
    scale: 1,
    opacity: 1,
    boxShadow: "0 20px 80px rgba(66, 133, 244, 0.4)",
    scrollTrigger: {
        trigger: ".experience-black",
        start: "top 80%",
        end: "bottom 80%",
        scrub: 1,
    }
});

// 4. True 3D Particle System - EXPLODING GALAXY
const canvas = document.getElementById('particle-canvas');
const ctx = canvas.getContext('2d');

gsap.set("#particle-canvas", { opacity: 1 });

let width, height;
function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    initParticles();
}
window.addEventListener('resize', resize);

const googleColors = ['#4285F4', '#EA4335', '#FBBC05', '#34A853', '#A142F4'];
const particles = [];

let mouse = { x: -1000, y: -1000 };
window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

const focalLength = 600; 

// --- Quản lý Vụ Nổ (Explosion State Machine) ---
let explosionState = 0; // 0: Thở bình thường, 1: Nổ văng ra, 2: Bị hút về vòng tròn to
let explosionTimer = 0;
let contractionPhase = 0; // 0: Giãn ra hết, 1: Hút vào thành lốc xoáy
let breathingDir = 1;     // 1: Đang hút vào, -1: Đang giãn ra

class Particle {
    constructor(radius, angle) {
        this.baseRadiusFromCenter = radius; 
        this.angle = angle;
        
        this.color = googleColors[Math.floor(Math.random() * googleColors.length)];
        this.baseSize = Math.random() * 2 + 2; 
        
        this.rotSpeed = -0.0008;
        
        // Vị trí thực tế trên màn hình (để hiển thị)
        this.x = 0;
        this.y = 0;
        this.zDepth = 1000;
        this.opacity = 1;
        this.currentSize = 2;
    }
    
    // Kích hoạt nổ tung
    explode() {
        // Lưu lại vị trí 3D thật lúc nổ
        this.expX = this.x;
        this.expY = this.y;
        this.expZ = this.zDepth;
        
        // Phân bổ Vector lực nổ (bay túa ra 3D)
        let angle = Math.random() * Math.PI * 2;
        let speed = Math.random() * 1500 + 500; // Tốc độ văng rất mạnh
        
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.vz = (Math.random() - 0.5) * 2000; // Văng tung chiều sâu Z
    }
    
    update(dt, contraction, now) {
        // 1. TÍNH TOÁN QUỸ ĐẠO TOÁN HỌC GỐC (Math Target)
        let currentRotSpeed = this.rotSpeed * (1 + contraction * 5);
        this.angle += currentRotSpeed;
        
        let denseRadius = (this.baseRadiusFromCenter / 3500) * 800;
        let currentRadius = this.baseRadiusFromCenter * (1 - contraction) + denseRadius * contraction;
        
        let x3d = Math.cos(this.angle) * currentRadius;
        let z3d = Math.sin(this.angle) * currentRadius;
        
        let waveY = Math.sin(this.baseRadiusFromCenter * 0.005 + now * 0.002) * 200;
        let funnelY = 1800 * Math.exp(-currentRadius / 350); 
        let y3d = waveY * (1 - contraction) + funnelY * contraction; 
        
        let tiltAngleX = Math.PI / 2.5; 
        let rotatedY = y3d * Math.cos(tiltAngleX) - z3d * Math.sin(tiltAngleX);
        let rotatedZ = y3d * Math.sin(tiltAngleX) + z3d * Math.cos(tiltAngleX);
        
        let finalZ = rotatedZ + 1500;
        if (finalZ < 10) finalZ = 10;
        
        let scale = focalLength / finalZ;
        
        let mathX = width / 2 + x3d * scale;
        let centerOffsetY = 100 - (contraction * 250); 
        let mathY = height / 2 + centerOffsetY + rotatedY * scale; 
        
        // 2. KIỂM TRA TRẠNG THÁI NỔ ĐỂ GÁN VỊ TRÍ
        if (explosionState === 0) {
            // -- Trạng thái Bình thường: Ở đúng vị trí toán học --
            let dx = mathX - mouse.x;
            let dy = mathY - mouse.y;
            let dist = Math.sqrt(dx*dx + dy*dy);
            
            // Gợn sóng với chuột chỉ kích hoạt khi bình thường
            if (dist < 300) {
                let intensity = (300 - dist) / 300;
                let wavePhase = dist * 0.05 - now * 0.006;
                let waveOffset = Math.sin(wavePhase) * 120 * intensity * scale * (1 - contraction);
                mathY -= waveOffset;
            }
            
            this.x = mathX;
            this.y = mathY;
            this.zDepth = finalZ;
            
            this.currentSize = Math.max(0.1, this.baseSize * scale);
            this.opacity = 1.2 - (finalZ / 2500); 
            this.opacity = Math.min(1, Math.max(0, this.opacity + contraction * 0.3));
            
        } else if (explosionState === 1) {
            // -- Trạng thái Nổ Tung: Bay lơ lửng tự do --
            this.expX += this.vx * dt;
            this.expY += this.vy * dt;
            this.expZ += this.vz * dt;
            
            // Lực cản không gian (Friction) làm các hạt chậm dần lại tạo cảnh tượng lơ lửng đẹp mắt
            this.vx *= 0.94;
            this.vy *= 0.94;
            this.vz *= 0.94;
            
            this.x = this.expX;
            this.y = this.expY;
            this.zDepth = this.expZ;
            
            let expScale = focalLength / Math.max(10, this.expZ);
            this.currentSize = Math.max(0.1, this.baseSize * expScale);
            
            this.opacity = 1.2 - (this.expZ / 2500); 
            this.opacity = Math.min(1, Math.max(0, this.opacity));
            
        } else if (explosionState === 2) {
            // -- Trạng thái Thu hồi: Kéo hút dần về Toán học --
            let lerpFactor = explosionTimer / 3.0; // 3 giây để thu về
            // Vuốt mượt đường cong thu hồi
            lerpFactor = lerpFactor * lerpFactor * (3 - 2 * lerpFactor); 
            if (lerpFactor > 1) lerpFactor = 1;
            
            // Nội suy (Lerp) từ vị trí trôi nổi về vị trí chuẩn
            this.x = this.expX * (1 - lerpFactor) + mathX * lerpFactor;
            this.y = this.expY * (1 - lerpFactor) + mathY * lerpFactor;
            this.zDepth = this.expZ * (1 - lerpFactor) + finalZ * lerpFactor;
            
            let currentScale = focalLength / Math.max(10, this.zDepth);
            this.currentSize = Math.max(0.1, this.baseSize * currentScale);
            
            this.opacity = 1.2 - (this.zDepth / 2500); 
            this.opacity = Math.min(1, Math.max(0, this.opacity));
            
            // Cập nhật lại vị trí expX để khung hình sau nội suy mượt hơn
            // (Thực ra giữ nguyên gốc và tăng lerpFactor là đủ)
        }
    }
    
    draw() {
        if(this.opacity <= 0) return;
        
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.fillStyle = this.color;
        ctx.globalAlpha = this.opacity;
        ctx.beginPath();
        ctx.ellipse(0, 0, this.currentSize * 1.5, this.currentSize, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function initParticles() {
    particles.length = 0;
    let totalParticles = 2500; 
    let maxRadius = 3500; 
    let maxTheta = 6 * Math.PI * 2;
    
    for (let i = 0; i < totalParticles; i++) {
        let t = i / totalParticles;
        let theta = Math.sqrt(t) * maxTheta;
        let radius = (theta / maxTheta) * maxRadius + 50;
        let thickness = 30 + (theta * 2); 
        let randomOffsetRadius = (Math.random() - 0.5) * thickness;
        let finalRadius = radius + randomOffsetRadius;
        let armOffset = (i % 2 === 0) ? 0 : Math.PI;
        particles.push(new Particle(finalRadius, theta + armOffset));
    }
}

resize();

let lastTime = performance.now();

function animate() {
    let now = performance.now();
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    
    // -- Quản lý State Machine Trái Tim Vũ Trụ --
    if (explosionState === 0) {
        // Hô hấp bình thường
        contractionPhase += breathingDir * dt * 0.12; // Mất tầm 8s 1 vòng
        if (contractionPhase > 1) {
            contractionPhase = 1;
            breathingDir = -1;
        } else if (contractionPhase < 0) {
            contractionPhase = 0;
            breathingDir = 1;
        }
        
        // Theo dõi chạm chuột để Nổ tung khi đang Lốc xoáy (contraction lớn)
        if (contractionPhase > 0.8) {
            let dx = width / 2 - mouse.x;
            let dy = height / 2 - mouse.y; // Tâm màn hình
            if (Math.sqrt(dx*dx + dy*dy) < 250) { // Bán kính kích nổ
                explosionState = 1; // Phát nổ
                explosionTimer = 0;
                particles.forEach(p => p.explode());
            }
        }
    } else if (explosionState === 1) {
        explosionTimer += dt;
        
        // Ngay khi nổ tung, ép toàn bộ trục toán học biến thành vòng tròn TO (giãn nở) để chờ hạt hội tụ về
        contractionPhase = 0; 
        breathingDir = 1; // Sẵn sàng thở từ vòng tròn to
        
        if (explosionTimer > 2.5) { // Bay lơ lửng 2.5 giây
            explosionState = 2; // Bắt đầu thu hồi
            explosionTimer = 0;
        }
    } else if (explosionState === 2) {
        explosionTimer += dt;
        
        if (explosionTimer >= 3.0) { // Hút về tốn 3 giây
            explosionState = 0; // Trở lại nhịp độ bình thường
        }
    }
    
    let contraction = contractionPhase * contractionPhase * (3 - 2 * contractionPhase);
    
    ctx.clearRect(0, 0, width, height);
    
    // Update tất cả các hạt
    particles.forEach(p => p.update(dt, contraction, now));
    
    // Sắp xếp Z-Depth để vẽ 3D
    particles.sort((a, b) => b.zDepth - a.zDepth);
    particles.forEach(p => p.draw());
    
    requestAnimationFrame(animate);
}
animate();
