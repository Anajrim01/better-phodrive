export type MenuGeometry = {
    x: number;
    y: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
    margin?: number;
};

export type MenuPlacement = {
    left: number;
    top: number;
    maxHeight: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/** Keep a menu inside the viewport, opening above the anchor when there is no room below. */
export function clampMenuPosition(geometry: MenuGeometry): MenuPlacement {
    const margin = geometry.margin ?? 8;
    const availableWidth = Math.max(1, geometry.viewportWidth - margin * 2);
    const maxHeight = Math.max(1, geometry.viewportHeight - margin * 2);
    const width = Math.min(geometry.width, availableWidth);
    const height = Math.min(geometry.height, maxHeight);
    const top =
        geometry.y + height > geometry.viewportHeight - margin ? geometry.y - height : geometry.y;

    return {
        left: clamp(geometry.x, margin, geometry.viewportWidth - margin - width),
        top: clamp(top, margin, geometry.viewportHeight - margin - height),
        maxHeight
    };
}
