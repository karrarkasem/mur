import { requireAuth } from "../../services/auth-guard.js";

requireAuth(() => {});
