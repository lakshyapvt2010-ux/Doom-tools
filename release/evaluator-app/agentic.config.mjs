import { filesystem } from 'agentic-tools/filesystem';
export default { workspace: process.cwd(), tools: filesystem() };
