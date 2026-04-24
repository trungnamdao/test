const fs = require('fs');
// Very naive GLB parser to check if it has textures or vertex colors
const buffer = fs.readFileSync('/Users/trungnamdao/Documents/anitigravity/3d logo typography.glb');
// The JSON chunk is the second chunk
const jsonLength = buffer.readUInt32LE(12);
const jsonString = buffer.toString('utf8', 20, 20 + jsonLength);
const gltf = JSON.parse(jsonString);

console.log("Materials:", JSON.stringify(gltf.materials, null, 2));
console.log("Meshes:", JSON.stringify(gltf.meshes, null, 2));

