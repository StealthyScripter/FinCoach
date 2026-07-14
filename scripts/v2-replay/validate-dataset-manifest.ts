import { loadHistoricalDatasetManifest, validateHistoricalDataset } from "../../server/v2/replay-verification";

const manifestPath = process.argv.includes("--dataset-manifest") ? process.argv[process.argv.indexOf("--dataset-manifest") + 1] : null;
if (!manifestPath) throw new Error("--dataset-manifest is required");
const loaded = loadHistoricalDatasetManifest(manifestPath);
const validation = await validateHistoricalDataset(loaded);
console.log(JSON.stringify(validation));
if (!validation.ok) process.exit(1);
