// 1. Función reutilizable para descargar el mapa
function descargarMapa(mapaInstance) {
    mapaInstance.triggerRepaint();
    
    requestAnimationFrame(() => {
        const canvas = mapaInstance.getCanvas();
        const dataURL = canvas.toDataURL('image/png');
        
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = 'vessel_hub_map.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}