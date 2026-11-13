import { Grid2X2 } from 'lucide-react';
import { Styles } from '../../shared/atoms';
export function AuthBrand({ className = '' }: { className?: string }) {
  return (
    <>
      <Styles id="auth-brand">{styles}</Styles>
      <a className={`auth-brand ${className}`.trim()} href="/login">
        <span>
          <Grid2X2 size={24} />
        </span>
        планировка<i>•</i>
      </a>
    </>
  );
}
const styles = String.raw`
.auth-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 25px;
  font-weight: 800;
  letter-spacing: -1px;
  color: #4c5a77;
  text-decoration: none;
}
.auth-brand > span {
  display: flex;
  padding: 9px;
  background: #8791db;
  color: #fff;
  border-radius: 12px;
}
.auth-brand i {
  color: #b4bdd8;
  font-style: normal;
  margin-left: 3px;
}
`;
