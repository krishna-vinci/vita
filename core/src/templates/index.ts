export type { AdoptionProposal } from "@vita/shared";
export { approveTemplate, proposeAdoption, savedProposal, templateAdopterRole } from "./adopt.js";
export { compileOriginal } from "./compile.js";
export {
  artifacts,
  discardTemplate,
  loadUpload,
  readArtifact,
  receiveTemplateUpload,
  templatePath,
  type UploadedTemplate,
} from "./storage.js";
export { TemplateError, UPLOAD_LIMIT } from "./zip.js";
