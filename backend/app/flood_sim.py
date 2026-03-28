from collections import deque

import numpy as np


def run_bfs_flood(
    elevation_grid: np.ndarray,
    source_edge: str,
    severity: int,
    rainfall_mm: float,
) -> np.ndarray:
    """
    BFS flood fill on elevation grid.
    Uses a flat water surface model — water fills to a uniform level
    and spreads to any connected cell below that level.

    Args:
        elevation_grid: 2D array of elevations in meters
        source_edge: "N", "S", "E", or "W" — where water enters from
        severity: 1-5, maps to base water rise in meters
        rainfall_mm: additional rainfall contribution

    Returns:
        2D array of flood depth in meters (0 = dry)
    """
    rows, cols = elevation_grid.shape
    depth = np.zeros((rows, cols), dtype=np.float64)

    # Water level: severity maps to 1-5m base rise + rainfall contribution
    base_rise = severity * 1.5  # 1.5m per severity level
    rain_rise = rainfall_mm / 150.0  # 100mm = 0.67m additional
    water_height = base_rise + rain_rise

    # Determine source edge cells
    if source_edge == "N":
        edge_cells = [(0, c) for c in range(cols)]
    elif source_edge == "S":
        edge_cells = [(rows - 1, c) for c in range(cols)]
    elif source_edge == "W":
        edge_cells = [(r, 0) for r in range(rows)]
    else:  # E
        edge_cells = [(r, cols - 1) for r in range(rows)]

    # The water surface is a flat plane at: median edge elevation + water_height
    # Using median instead of min gives more realistic results across varied terrain
    edge_elevations = np.array([elevation_grid[r, c] for r, c in edge_cells])
    water_surface = float(np.median(edge_elevations)) + water_height

    # BFS: flood any connected cell whose elevation is below the water surface
    visited = np.zeros((rows, cols), dtype=bool)
    queue = deque()

    # Seed with edge cells below water surface
    for r, c in edge_cells:
        if elevation_grid[r, c] < water_surface:
            queue.append((r, c))
            visited[r, c] = True
            depth[r, c] = water_surface - elevation_grid[r, c]

    # 4-connected neighbors
    directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]

    while queue:
        r, c = queue.popleft()

        for dr, dc in directions:
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and not visited[nr, nc]:
                neighbor_elev = elevation_grid[nr, nc]
                if neighbor_elev < water_surface:
                    visited[nr, nc] = True
                    d = water_surface - neighbor_elev
                    if d > 0.05:  # minimum 5cm to count as flooded
                        depth[nr, nc] = d
                        queue.append((nr, nc))

    return depth
