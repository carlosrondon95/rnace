const { Jimp } = require('jimp');
const fs = require('fs');
const path = require('path');

const sourceIcon = path.join(__dirname, '../src/assets/icon/logofull.JPG');
const distDir = path.join(__dirname, '../src/assets/icons');

// Create destination directory if it doesn't exist
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

async function generateIcons() {
    console.log(`Reading source icon from: ${sourceIcon}`);

    try {
        // If Jimp is undefined, try default export or the module itself
        const jimpInstance = Jimp || require('jimp');

        const image = await jimpInstance.read(sourceIcon);

        for (const size of sizes) {
            const fileName = `icon-${size}x${size}.png`;
            const destPath = path.join(distDir, fileName);

            await image
                .clone() // Clone the image so we don't modify the original for next iteration
                .resize({ w: size, h: size }) // Resize (syntax might vary, trying object or params)
                .write(destPath); // Save

            console.log(`Generated: ${fileName}`);
        }

        console.log('All icons generated successfully!');

    } catch (err) {
        console.error('Error generating icons:', err);
        console.log('Jimp object:', Jimp);
        console.log('require(jimp):', require('jimp'));
    }
}

generateIcons();
