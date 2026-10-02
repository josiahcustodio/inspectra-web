Goal: Create a high-fidelity, polished, and exceptionally user-friendly UI design for the "Clowtec Admin Center" Web Portal. The primary user is a City Health Office supervisor or data analyst. The design must minimize cognitive load, allowing the user to understand the health status of the entire city in under 10 seconds.

1. Color Scheme & Typography (Crucial for Brand Consistency):

Color Palette: Strictly adhere to the Sage Green (#87A96B) primary color for highlights, borders, and active states. Backgrounds must be pure White (#FFFFFF). Use a clean Dark Charcoal (#333333) for main text and a subdued Light Gray (#999999) for secondary labels.

Typography: Use a modern, readable, and professional sans-serif typeface (e.g., Inter, Public Sans, or Archivo). Headers should be bold, and body text should have generous line height for readability.

2. Layout: The "Command Center" Bento Grid:

Structure: Design the dashboard using a modern, clean "Bento Box" layout grid, where each key metric is housed in its own clearly defined white card with subtly rounded corners.

Navigation: Use a slim left-hand sidebar with clean, white minimalist icons and text labels: Dashboard, Establishments, Inspections, GIS Map, Inspectors, Settings. The active link should be highlighted with a soft sage green background.

3. Decision-Making Visualizations (The Hackathon "Aha!" Moment):

Primary Graph: "Violation Hotspot Analysis (Weekly Trend)" stacked bar chart.

Logic: X-axis = Last 6 Weeks. Y-axis = Number of Violations. Each bar is a stacked breakdown of specific violation types derived from the form in image_0.png (e.g., Water Supply, Vermin Control, Food Safety, Waste Management).

Decision Impact: This helps the office instantly decide where to focus public health education or enforcement based on current spikes (e.g., "Water Supply" violations are spiking).

Secondary Graph: "Sanitary Grade Distribution" donut chart showing the percentage of city establishments holding A (Excellent - Sage Green), B (Satisfactory - Yellow), and C/F (Failed - Red) ratings.

4. Intuitive Control Modules:

Header: A clean search bar at the top ("Search by name, ID, or barangay"). In the top right, a "Hello, Supervisor" greeting and a profile icon, matching the mobile app's profile aesthetic.

Key Stats (Bento Grid): Three large-number cards:

1. Total Establishments (with a small "newly added" indicator).

2. Inspections Completed Today (comparing to yesterday's trend).

3. Critical Failures (Requires Immediate Re-inspection) – This number must be in Red to signal urgency.

5. Real-Time Operation Feed:

GIS Map: A simplified, subdued map of Batangas City/the municipality.

Pins: The map is dotted with interactive pins. Clicking a green pin shows an establishment with an "A" rating. Clicking a red pin shows a failed establishment.

Live Inspection Table: Directly below the main graph, create a clean table with a live feed of incoming inspections. Columns: Establishment Name, Inspector ID, Score (Colored based on Grade), Date, View Report (Simple Sage Green button).