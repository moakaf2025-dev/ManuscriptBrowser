// The jsdom bundled with react-scripts 5 predates TextEncoder/TextDecoder, which
// docx needs to serialise OOXML. Node has shipped both since v11, so hand them over.
import { TextEncoder, TextDecoder } from "util";

if (typeof global.TextEncoder === "undefined") global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === "undefined") global.TextDecoder = TextDecoder;
