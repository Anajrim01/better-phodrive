export type MarqueeRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

export function marqueeRect(
    startX: number,
    startY: number,
    endX: number,
    endY: number
): MarqueeRect {
    return {
        left: Math.min(startX, endX),
        top: Math.min(startY, endY),
        right: Math.max(startX, endX),
        bottom: Math.max(startY, endY)
    };
}

export function intersects(rect: MarqueeRect, other: MarqueeRect): boolean {
    return (
        rect.left < other.right &&
        rect.right > other.left &&
        rect.top < other.bottom &&
        rect.bottom > other.top
    );
}
