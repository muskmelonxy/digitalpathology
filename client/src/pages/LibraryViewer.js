import { useParams } from 'react-router-dom';
import WsiViewer from './WsiViewer';

export default function LibraryViewer() {
  const { filename } = useParams();
  return <WsiViewer root="library" filename={filename} />;
}
