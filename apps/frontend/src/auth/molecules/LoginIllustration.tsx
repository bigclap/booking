import { Building2, Grid2X2 } from 'lucide-react';
import { Styles } from '../../shared/atoms';
import { AuthBrand } from '../atoms/AuthBrand';
export function LoginIllustration() {
  return (
    <>
      <Styles id="login-illustration">{styles}</Styles>{' '}
      <section className="auth-story" aria-label="Планировка офиса">
        <AuthBrand />
        <div className="auth-story-copy">
          <span className="auth-kicker">РАБОЧЕЕ ПРОСТРАНСТВО</span>
          <h1>
            Место для вас.
            <br />И вашей команды.
          </h1>
          <p>
            Рабочие места и переговорные
            <br />
            на одном плане офиса.
          </p>
        </div>
        <div className="auth-office-art" aria-hidden="true">
          <div className="auth-art-label">
            <Building2 size={15} />
            <span>Ваш офис</span>
            <b>1 этаж</b>
          </div>
          <div className="auth-mini-plan">
            <div className="auth-mini-room">
              <small>Переговорная</small>
              <img
                className="auth-meeting-table"
                src="/assets/furniture/meeting-table.svg"
                alt=""
              />
              {[0, 1, 2, 3].map((i) => (
                <img
                  key={i}
                  className={'auth-art-chair chair-' + i}
                  src="/assets/furniture/chair.svg"
                  alt=""
                />
              ))}
              <span className="auth-art-available">
                <i />
                Свободно
              </span>
            </div>
            <div className="auth-mini-desks">
              {[0, 1, 2, 3].map((i) => (
                <div className={'auth-art-desk desk-' + i} key={i}>
                  <img src="/assets/furniture/desk.svg" alt="" />
                  <img src="/assets/furniture/monitor.svg" alt="" />
                  <img src="/assets/furniture/chair.svg" alt="" />
                </div>
              ))}
            </div>
            <div className="auth-mini-lounge">
              <img src="/assets/furniture/sofa-3.svg" alt="" />
              <img src="/assets/furniture/plant.svg" alt="" />
            </div>
          </div>
          <div className="auth-art-booking">
            <span>
              <Grid2X2 size={18} />
            </span>
            <div>
              <b>Ваше место найдено</b>
              <small>Выберите время — и можно работать</small>
            </div>
            <div className="auth-art-check">✓</div>
          </div>
        </div>
        <span className="auth-story-note">
          <span />
          Всё начинается с удобного места
        </span>
      </section>
    </>
  );
}

const styles = String.raw`
.auth-story {
  background: #f0f2fc;
  position: relative;
  overflow: hidden;
  padding: 42px 7%;
  display: flex;
  flex-direction: column;
  min-height: 790px;
}

.auth-story-copy {
  margin-top: 65px;
  z-index: 1;
}

.auth-story h1 {
  font-size: clamp(33px, 3.3vw, 53px);
  letter-spacing: -2px;
  line-height: 1.18;
  margin: 18px 0;
}

.auth-story-copy p {
  font-size: 14px;
  color: #8790aa;
  line-height: 1.8;
}

.auth-office-art {
  position: relative;
  margin: 20px auto 55px;
  max-width: 460px;
  width: 100%;
  transform: rotate(-5deg);
}

.auth-art-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #8792ad;
  font-size: 10px;
  padding: 16px 2px;
}

.auth-art-label b {
  margin-left: auto;
  padding: 6px 9px;
  background: #ffffffaa;
  border-radius: 7px;
  color: #8792ad;
  font-weight: 500;
}

.auth-mini-plan {
  position: relative;
  display: grid;
  grid-template-columns: 45% 55%;
  grid-template-rows: 200px 100px;
  padding: 10px;
  background: white;
  box-shadow: 0 25px 70px #586a9d16;
  border-radius: 12px;
  border: 1px solid #e2e6f3;
}

.auth-mini-room {
  position: relative;
  border: 5px solid #697c89;
  border-bottom: 0;
  background: #e4f3ec;
  border-radius: 3px 0 0;
}

.auth-mini-room small {
  position: absolute;
  top: 12px;
  left: 10px;
  font-size: 10px;
  color: #768f85;
}

.auth-meeting-table {
  position: absolute;
  width: 95px;
  height: 95px;
  object-fit: contain;
  left: calc(50% - 47px);
  top: 50px;
}

.auth-art-chair {
  position: absolute;
  width: 30px;
  height: 30px;
}

.auth-art-available {
  position: absolute;
  bottom: 7px;
  left: 9px;
  font-size: 8px;
  color: #438b74;
  display: flex;
  align-items: center;
  gap: 4px;
}

.auth-art-available i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #61b899;
}

.auth-mini-desks {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 22px 12px;
  border: 5px solid #697c89;
  border-left: 0;
  border-bottom: 0;
  padding: 25px 11px 12px;
}

.auth-art-desk {
  position: relative;
  height: 55px;
  border: 1px solid #c6e7db;
  background: #eff9f4;
  border-radius: 7px;
}

.auth-art-desk > img:first-child {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.auth-art-desk > img:nth-child(2) {
  position: absolute;
  width: 40%;
  height: 35%;
  left: 30%;
  top: 5px;
}

.auth-art-desk > img:last-child {
  position: absolute;
  width: 25px;
  height: 25px;
  left: calc(50% - 12px);
  bottom: -17px;
}

.auth-mini-lounge {
  grid-column: span 2;
  border: 5px solid #697c89;
  border-top: 5px solid #697c89;
  position: relative;
  background: #fafbfe;
}

.auth-mini-lounge > img:first-child {
  width: 110px;
  height: 65px;
  position: absolute;
  left: 20px;
  top: 8px;
}

.auth-mini-lounge > img:last-child {
  width: 35px;
  height: 35px;
  position: absolute;
  right: 25px;
  top: 22px;
}

.auth-art-booking {
  position: absolute;
  bottom: -24px;
  right: -15px;
  display: flex;
  align-items: center;
  gap: 11px;
  background: #fff;
  padding: 15px 17px;
  border: 1px solid #e8ebf5;
  border-radius: 12px;
  box-shadow: 0 10px 40px #586a9d18;
  transform: rotate(5deg);
}

.auth-art-booking > span {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #eff2ff;
  color: #7b85cd;
}

.auth-art-booking b {
  display: block;
  color: #53617e;
  font-size: 11px;
}

.auth-art-booking small {
  font-size: 8px;
  color: #929cb1;
  display: block;
  margin-top: 5px;
}

.auth-art-check {
  color: #62a98d;
  background: #eaf7ef;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  text-align: center;
  margin-left: 15px;
}

.auth-story-note {
  font-size: 10px;
  color: #9ca6bc;
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 7px;
}

.auth-story-note > span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #a6b0dd;
}
@media (min-width: 1600px) {
  .auth-story {
    padding-left: 14%;
    padding-right: 14%;
  }

  .auth-office-art {
    margin-top: 40px;
  }

  .auth-story-copy {
    margin-top: 85px;
  }
}
@media (max-width: 1000px) {
  .auth-story {
    padding: 35px 9%;
    min-height: 750px;
  }

  .auth-story h1 {
    font-size: 35px;
  }

  .auth-mini-plan {
    grid-template-rows: 180px 90px;
  }

  .auth-mini-room .auth-art-chair {
    width: 24px;
    height: 24px;
  }

  .auth-art-chair.chair-0,
  .auth-art-chair.chair-1 {
    top: 47px;
  }

  .auth-art-chair.chair-2,
  .auth-art-chair.chair-3 {
    top: 137px;
  }

  .auth-art-booking {
    right: -12px;
    padding: 12px;
    gap: 7px;
  }

  .auth-art-check {
    margin-left: 3px;
  }

  .auth-art-booking small {
    font-size: 7px;
  }

  .auth-mini-desks {
    gap: 22px 8px;
    padding: 25px 7px 10px;
  }
}
@media (max-width: 760px) {
  .auth-story {
    display: none;
  }
}
`;
