export type { AdoptionProposal } from "@vita/shared";
export { approveTemplate, proposeAdoption, savedProposal, templateAdopterRole } from "./adopt.js";
export { compileOriginal } from "./compile.js";
export { templateContract } from "./contract.js";
export {
  editableTemplate,
  forkTemplate,
  previewResume,
  previewTemplate,
  sampleResume,
  saveTemplateSource,
  sourceHash,
  validateTemplateSource,
} from "./edit.js";
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
