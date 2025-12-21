const fs = require('fs');
const targetPath = 'src/app/components/calendario/calendario.component.ts';
const methodsPath = 'new_methods.ts';

try {
    let content = fs.readFileSync(targetPath, 'utf8');
    let newMethods = fs.readFileSync(methodsPath, 'utf8');

    const lines = content.split(/\r?\n/);
    const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';

    // 1. Encontrar y borrar basura
    const startGarbageIndex = lines.findIndex(l => l.trim().startsWith('// Variable para almacenar las reservas'));
    const endGarbageIndex = lines.findIndex(l => l.trim().startsWith('@Component({'));

    if (startGarbageIndex !== -1 && endGarbageIndex !== -1 && startGarbageIndex < endGarbageIndex) {
        console.log(`Borrando basura: ${startGarbageIndex} a ${endGarbageIndex}`);
        lines.splice(startGarbageIndex, endGarbageIndex - startGarbageIndex);
    } else {
        console.log('No basura encontrada o ya limpia.');
    }

    // 2. Insertar métodos desde new_methods.ts antes de ngOnInit
    const ngInitIndex = lines.findIndex(l => l.trim().startsWith('ngOnInit() {'));
    if (ngInitIndex !== -1) {
        console.log(`Insertando metodos en linea ${ngInitIndex}`);
        lines.splice(ngInitIndex, 0, newMethods);
        fs.writeFileSync(targetPath, lines.join(lineEnding), 'utf8');
        console.log('Archivo guardado con exito.');
    } else {
        console.error('CRITICO: No se encontro ngOnInit(). No se guardo nada.');
    }

} catch (e) {
    console.error(e);
}
